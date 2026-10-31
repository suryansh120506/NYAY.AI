"""Phone OTP sign-in (brief §1.4): progressive auth, short access JWT, rotating httpOnly refresh cookie."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Request, Response
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert

from app.core.deps import DbDep, ProvidersDep, client_ip
from app.core.errors import AppError
from app.core.logging import get_logger, mask_phone
from app.core.providers import Providers
from app.core.ratelimit import enforce
from app.core.security import hash_otp, hash_token, issue_access_token, new_refresh_token
from app.db.models.tables import RefreshToken, User
from app.db.tx import transaction
from app.ledger.posting import ensure_wallet

from .schemas import AuthSession, AuthUser, OtpRequestIn, OtpRequestOut, OtpVerifyIn

router = APIRouter(prefix="/v1/auth", tags=["auth"])
log = get_logger("auth")

REFRESH_COOKIE = "nyay_rt"
RESEND_SECONDS = 30


def _otp_key(providers: Providers, phone: str) -> str:
    return f"otp:{hash_token(phone + providers.settings.jwt_secret.get_secret_value()[:8])[:32]}"


def _set_refresh_cookie(response: Response, providers: Providers, token: str) -> None:
    settings = providers.settings
    response.set_cookie(
        REFRESH_COOKIE,
        token,
        max_age=settings.refresh_token_ttl_days * 86_400,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        domain=settings.cookie_domain or None,
        path="/v1/auth",
    )


async def _issue_session(
    db: DbDep, providers: Providers, response: Response, user: User, device: str | None
) -> AuthSession:
    token, token_hash = new_refresh_token()
    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=token_hash,
            expires_at=datetime.now(UTC) + timedelta(days=providers.settings.refresh_token_ttl_days),
            device_info=(device or "")[:200] or None,
        )
    )
    access, expires = issue_access_token(providers.settings, user_id=user.id, role=user.role.value)
    _set_refresh_cookie(response, providers, token)
    return AuthSession(user=AuthUser.of(user), access_token=access, expires_at=expires)


@router.post("/otp/request", response_model=OtpRequestOut)
async def request_otp(body: OtpRequestIn, request: Request, providers: ProvidersDep) -> OtpRequestOut:
    settings, redis = providers.settings, providers.redis
    await enforce(redis, scope="otp-ip", identity=client_ip(request), rule=settings.rate_limit_otp)
    await enforce(
        redis, scope="otp-phone", identity=hash_token(body.phone_e164)[:24], rule=settings.rate_limit_otp
    )
    key = _otp_key(providers, body.phone_e164)
    if not await redis.set(f"{key}:cooldown", "1", ex=RESEND_SECONDS, nx=True):
        raise AppError(
            "rate_limited", 429, "Please wait before asking for another code.", retry_after=RESEND_SECONDS
        )
    code = providers.otp.generate()
    await redis.set(key, hash_otp(body.phone_e164, code, settings), ex=settings.otp_ttl_seconds)
    await redis.delete(f"{key}:attempts")
    await providers.otp.send(body.phone_e164, code)
    log.info("otp.requested", phone=mask_phone(body.phone_e164))
    return OtpRequestOut(resend_after_seconds=RESEND_SECONDS)


@router.post("/otp/verify", response_model=AuthSession)
async def verify_otp(
    body: OtpVerifyIn, request: Request, response: Response, db: DbDep, providers: ProvidersDep
) -> AuthSession:
    settings, redis = providers.settings, providers.redis
    key = _otp_key(providers, body.phone_e164)
    attempts = await redis.incr(f"{key}:attempts")
    await redis.expire(f"{key}:attempts", settings.otp_ttl_seconds)
    stored = await redis.get(key)
    if (
        attempts > settings.otp_max_attempts
        or stored is None
        or stored != hash_otp(body.phone_e164, body.code, settings)
    ):
        if attempts > settings.otp_max_attempts:
            await redis.delete(key)
        raise AppError("invalid_otp", 401, "That code didn't match.")
    await redis.delete(key, f"{key}:attempts")

    async with transaction(db):
        await db.execute(
            insert(User)
            .values(phone_e164=body.phone_e164)
            .on_conflict_do_nothing(index_elements=["phone_e164"])
        )
        user = (await db.execute(select(User).where(User.phone_e164 == body.phone_e164))).scalar_one()
        await ensure_wallet(db, user.id)
        session = await _issue_session(db, providers, response, user, request.headers.get("user-agent"))
    log.info("auth.signed_in", user_id=str(user.id))
    return session


@router.post("/refresh", response_model=AuthSession)
async def refresh(request: Request, response: Response, db: DbDep, providers: ProvidersDep) -> AuthSession:
    token = request.cookies.get(REFRESH_COOKIE)
    if not token:
        raise AppError("unauthorized", 401, "Please sign in.")
    now = datetime.now(UTC)
    reuse_detected = False
    async with transaction(db):
        row = await db.scalar(
            select(RefreshToken).where(RefreshToken.token_hash == hash_token(token)).with_for_update()
        )
        if row is None or row.expires_at <= now:
            raise AppError("unauthorized", 401, "Please sign in.")
        if row.revoked_at is not None:
            # A rotated token came back: assume theft and end every session for this user. The revocation must
            # commit, so the error is raised only after the transaction closes.
            await db.execute(
                update(RefreshToken)
                .where(RefreshToken.user_id == row.user_id, RefreshToken.revoked_at.is_(None))
                .values(revoked_at=now)
            )
            reuse_detected = True
            log.warning("auth.refresh_reuse_detected", user_id=str(row.user_id))
        else:
            row.revoked_at = now
            user = (await db.execute(select(User).where(User.id == row.user_id))).scalar_one()
            session = await _issue_session(db, providers, response, user, request.headers.get("user-agent"))
    if reuse_detected:
        raise AppError("unauthorized", 401, "Please sign in again.")
    return session


@router.post("/logout", status_code=204)
async def logout(request: Request, response: Response, db: DbDep, providers: ProvidersDep) -> Response:
    token = request.cookies.get(REFRESH_COOKIE)
    if token:
        async with transaction(db):
            await db.execute(
                update(RefreshToken)
                .where(RefreshToken.token_hash == hash_token(token), RefreshToken.revoked_at.is_(None))
                .values(revoked_at=datetime.now(UTC))
            )
    response = Response(status_code=204)
    response.delete_cookie(REFRESH_COOKIE, path="/v1/auth", domain=providers.settings.cookie_domain or None)
    return response
