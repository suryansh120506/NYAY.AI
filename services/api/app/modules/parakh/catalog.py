"""Static vocabulary for matching. Court names are seeded into the `courts` table; this is only for labels/cities."""

from __future__ import annotations

from typing import Literal

StateCode = Literal["UP", "DL"]

PRIMARY_CITIES: list[tuple[str, StateCode]] = [
    ("lucknow", "UP"),
    ("delhi", "DL"),
    ("prayagraj", "UP"),
    ("kanpur_nagar", "UP"),
]
MORE_CITIES: list[tuple[str, StateCode]] = [
    ("varanasi", "UP"),
    ("agra", "UP"),
    ("gautam_buddh_nagar", "UP"),
    ("ghaziabad", "UP"),
]
SUPPORTED_DISTRICTS: dict[str, StateCode] = dict(PRIMARY_CITIES + MORE_CITIES)

AREA_LABELS: dict[str, dict[str, str]] = {
    "en": {
        "tenancy": "tenancy",
        "cheque_bounce": "cheque bounce",
        "consumer": "consumer",
        "matrimonial": "matrimonial",
        "criminal_bail": "criminal and bail",
        "property": "property",
        "employment": "employment",
    },
    "hi": {
        "tenancy": "किरायेदारी",
        "cheque_bounce": "चेक बाउंस",
        "consumer": "उपभोक्ता",
        "matrimonial": "वैवाहिक",
        "criminal_bail": "आपराधिक और ज़मानत",
        "property": "संपत्ति",
        "employment": "रोज़गार",
    },
}

LANGUAGE_NAMES: dict[str, dict[str, str]] = {
    "en": {"hi": "Hindi", "en": "English", "ur": "Urdu", "pa": "Punjabi", "bho": "Bhojpuri"},
    "hi": {"hi": "हिंदी", "en": "अंग्रेज़ी", "ur": "उर्दू", "pa": "पंजाबी", "bho": "भोजपुरी"},
}
