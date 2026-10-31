"""Saransh clause analysis (phase 2 contract): pure rules, then the flag-gated endpoint end to end."""

from __future__ import annotations

import httpx

from app.modules.saransh.clauses import analyse, assess, risk_score, risk_tier

from .api_harness import sign_in
from .test_saransh_praman import text_pdf, upload, wait_ready

AGREEMENT = [
    "RENT AGREEMENT between the owner and the tenant of a flat in Lucknow.",
    "1. The term of this agreement is eleven months from the date of signing.",
    "2. The security deposit of Rs. 90,000 shall be forfeited if the tenant leaves early.",
    "3. The owner may enter the flat at any time to inspect it.",
    "4. The owner may revise the rent at any time at his sole discretion.",
    "5. Disputes will be settled by the courts at Lucknow.",
]


def test_rules_flag_one_sided_clauses_and_leave_ordinary_ones_alone() -> None:
    assert assess("The security deposit shall be forfeited on early exit.") == ("high", "deposit_forfeiture")
    assert assess("The licensor may enter the premises without prior notice.") == (
        "high",
        "entry_without_notice",
    )
    assert assess("Rent may be revised at the sole discretion of the owner.") == (
        "review",
        "unilateral_change",
    )
    assert assess("Late payment carries interest of 2% per day.") == ("review", "steep_penalty")
    assert assess("The deposit will be refunded within 30 days of handover.") == ("standard", None)
    assert assess("The term of this agreement is eleven months.") == ("standard", None)


def test_clauses_are_split_by_number_with_offsets_into_each_page() -> None:
    page_one = "\n".join(AGREEMENT[:4])
    page_two = "\n".join(AGREEMENT[4:])
    found = analyse([page_one, page_two])
    assert [(c.number, c.page, c.level) for c in found] == [
        (1, 1, "standard"),
        (2, 1, "high"),
        (3, 1, "high"),
        (4, 2, "review"),
        (5, 2, "standard"),
    ]
    # Offsets select exactly the clause, so the viewer can highlight it in the person's own file.
    second = found[1]
    assert page_one[second.start : second.end] == AGREEMENT[2]
    assert analyse(["A letter with no numbered clauses at all."]) == []


def test_score_matches_the_web_preview() -> None:
    assert risk_score(["high", "high", "review", "standard"]) == 51
    assert risk_score(["high"] * 6) == 100
    assert (risk_tier(29), risk_tier(30), risk_tier(60)) == ("low", "moderate", "high")


async def test_endpoint_is_invisible_until_the_flag_is_on(api: httpx.AsyncClient) -> None:
    token, _ = await sign_in(api)
    h = {"Authorization": f"Bearer {token}"}
    r = await upload(api, h, text_pdf(AGREEMENT), "agreement.pdf")
    doc = await wait_ready(api, r.json()["document_id"], h)
    assert doc["status"] == "ready"
    assert (await api.get(f"/v1/saransh/documents/{doc['id']}/clauses", headers=h)).status_code == 404


async def test_clauses_are_stored_as_structure_only_and_served_with_a_score(api: httpx.AsyncClient) -> None:
    api.providers.settings.saransh_clauses_enabled = True  # type: ignore[attr-defined]
    token, _ = await sign_in(api)
    h = {"Authorization": f"Bearer {token}"}
    r = await upload(api, h, text_pdf(AGREEMENT), "agreement.pdf")
    doc = await wait_ready(api, r.json()["document_id"], h)
    assert doc["status"] == "ready"

    r = await api.get(f"/v1/saransh/documents/{doc['id']}/clauses", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert [c["level"] for c in body["clauses"]] == ["standard", "high", "high", "review", "standard"]
    assert body["risk_points"] == 51 and body["risk_tier"] == "moderate"
    # No clause text in the response (or in storage): numbers, offsets, levels and rule ids only.
    assert set(body["clauses"][0]) == {"number", "page", "start", "end", "level", "rule"}
    assert "forfeited" not in r.text

    other, _ = await sign_in(api)
    assert (
        await api.get(
            f"/v1/saransh/documents/{doc['id']}/clauses", headers={"Authorization": f"Bearer {other}"}
        )
    ).status_code == 404
