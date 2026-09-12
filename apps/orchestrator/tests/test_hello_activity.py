import unittest

from temporalio.testing import ActivityEnvironment

from hello_activity import ComposeGreetingInput, compose_greeting


class GreetingActivityTest(unittest.TestCase):
    def test_activity_accepts_custom_greeting_and_name(self):
        result = ActivityEnvironment().run(
            compose_greeting, ComposeGreetingInput(greeting="Welcome", name="Relay")
        )
        self.assertEqual(result, "Welcome, Relay!")
