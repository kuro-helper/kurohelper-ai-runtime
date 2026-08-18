import json
import unittest

from memory_candidates import (
    build_candidate_messages,
    candidate_operations,
    local_skip_reason,
)

KNOWN = [
    {"id": "discord:1", "display_name": "TestUserA", "role": "current_speaker"},
    {"id": "discord:2", "display_name": "TestUserB", "role": "recent_speaker"},
    {"id": "discord:3", "display_name": "Tommy", "role": "mentioned_user"},
    {"id": "kuro", "display_name": "Kuro", "role": "assistant"},
]


def recent_message(
    content: str,
    *,
    message_id: str = "message-1",
    user_id: str = "2",
    display_name: str = "TestUserB",
) -> dict:
    return {
        "id": message_id,
        "user_id": user_id,
        "display_name": display_name,
        "content": content,
        "assistant": False,
        "created_at": "2026-08-18T10:00:00+08:00",
    }


def turn(
    text: str,
    recent_messages: list[dict] | None = None,
    recent_context: str = "",
) -> dict:
    return {
        "user_text": text,
        "assistant_text": "……嗯。我記住了。",
        "recent_messages": recent_messages or [],
        "recent_context": recent_context,
    }


class MemoryCandidateTests(unittest.TestCase):
    def test_empty_candidate_array_creates_no_operation(self):
        self.assertEqual(candidate_operations({"memories": []}), [])
        self.assertEqual(candidate_operations({}), [])

    def test_candidates_are_only_local_add_requests(self):
        operations = candidate_operations(
            {"memories": [{"summary": "TestUserA喜歡紅茶。"}]}
        )
        self.assertEqual(operations[0]["action"], "ADD")
        self.assertEqual(operations[0]["id"], "")

    def test_recent_context_is_omitted_for_self_contained_message(self):
        messages = build_candidate_messages(
            turn("我喜歡無糖紅茶", [recent_message("很久以前的無關對話")]),
            [KNOWN[0], KNOWN[1], KNOWN[3]],
        )
        payload = json.loads(messages[1]["content"])
        self.assertNotIn("recent_context", payload)
        self.assertNotIn("recent_messages", payload)
        self.assertEqual(
            [item["id"] for item in payload["participants"]],
            ["discord:1", "kuro"],
        )

    def test_recent_context_is_included_for_reference(self):
        messages = build_candidate_messages(
            turn(
                "剛才那件事就照這樣決定",
                [
                    recent_message(
                        "要把備份保留五份",
                        user_id="3",
                        display_name="Tommy",
                    )
                ],
            ),
            KNOWN,
        )
        payload = json.loads(messages[1]["content"])
        self.assertEqual(payload["recent_messages"][0]["content"], "要把備份保留五份")
        self.assertNotIn("recent_context", payload)
        self.assertIn("discord:3", [item["id"] for item in payload["participants"]])

    def test_context_speaker_is_mapped_when_only_context_names_them(self):
        messages = build_candidate_messages(
            turn(
                "他剛才提出的方案就這樣決定",
                [recent_message("建議每天備份一次")],
            ),
            [KNOWN[0], KNOWN[1], KNOWN[3]],
        )
        payload = json.loads(messages[1]["content"])
        self.assertIn("discord:2", [item["id"] for item in payload["participants"]])

    def test_reply_relationship_remains_structured(self):
        message = recent_message("我同意這個方案")
        message["reply_to"] = {
            "message_id": "message-0",
            "user_id": "3",
            "display_name": "Tommy",
            "content": "備份保留五份",
            "assistant": False,
            "image_count": 0,
            "unavailable": False,
        }
        messages = build_candidate_messages(
            turn("剛才那件事就照這樣決定", [message]),
            KNOWN,
        )
        payload = json.loads(messages[1]["content"])
        reply = payload["recent_messages"][0]["reply_to"]
        self.assertEqual(reply["message_id"], "message-0")
        self.assertEqual(reply["display_name"], "Tommy")

    def test_local_prefilter_is_conservative(self):
        self.assertEqual(local_skip_reason(turn("早安")), "simple_greeting")
        self.assertEqual(local_skip_reason(turn("小黑 /newchat")), "bot_command")
        self.assertEqual(local_skip_reason(turn("解釋廣義相對論")), "knowledge_request")
        self.assertEqual(local_skip_reason(turn("我喜歡無糖紅茶")), "")
        self.assertEqual(local_skip_reason(turn("請記住我喜歡無糖紅茶")), "")


if __name__ == "__main__":
    unittest.main()
