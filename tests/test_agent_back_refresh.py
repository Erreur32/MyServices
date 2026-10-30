"""An agent back from a silence has its ports read at once, not at the next scheduled collect."""
import unittest
from unittest import mock

try:
    from msv.api.routes import access
except ImportError:
    access = None


@unittest.skipIf(access is None, "FastAPI absent")
class AgentBackRefresh(unittest.TestCase):
    def chains_for(self, state):
        with mock.patch.object(access, "core") as core:
            core.enabled.return_value = True
            agent = {"name": "pc", "ip": "10.0.0.5", "last_seen": 1.0, "version": "9", "state": state}
            access.refresh_after_report(agent, {"version": "9"}, "ok", "ok")
        return core.run_chain.call_count

    def test_collect_runs_when_the_agent_comes_back(self):
        self.assertEqual(self.chains_for("silencieux"), 1)

    def test_no_collect_for_a_regular_report(self):
        self.assertEqual(self.chains_for("actif"), 0)


if __name__ == "__main__":
    unittest.main()
