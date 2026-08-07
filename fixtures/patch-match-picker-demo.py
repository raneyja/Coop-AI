"""Demo file for testing Coop's multi-location patch picker.

Open this file, then ask Coop the prompt in the comment at the bottom.
Both dicts end with the same `}` — a lazy SEARCH will match twice.
"""


def get_inverse_relation(relation_type: str) -> str:
    relation_mapping = {
        "blocking": "blocked_by",
        "blocked_by": "blocking",
        "duplicate": "duplicate",
    }
    return relation_mapping.get(relation_type, relation_type)


def get_actual_relation(relation_type: str) -> str:
    actual_relation = {
        "blocking": "blocking",
        "blocked_by": "blocked_by",
        "duplicate": "duplicate",
    }
    return actual_relation.get(relation_type, relation_type)


# Prompt to paste in Coop chat (with this file open / in scope):
# Add a new relation type "start_before" → "start_after" in get_inverse_relation,
# and "start_before" → "start_before" in get_actual_relation.
