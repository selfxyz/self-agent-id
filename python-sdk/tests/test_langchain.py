# SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
# SPDX-License-Identifier: BUSL-1.1
# NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import json
import asyncio
from unittest.mock import MagicMock, patch

import pytest


# ── Import guard ──────────────────────────────────────────────────────────

def test_import_guard_gives_clear_error():
    """If langchain-core is not installed, importing should raise ImportError."""
    import importlib
    import self_agent_sdk.langchain as mod

    with patch.dict("sys.modules", {"langchain_core": None, "langchain_core.tools": None}):
        with pytest.raises(ImportError, match="langchain-core"):
            importlib.reload(mod)


# ── SelfAuthenticatedRequestTool ──────────────────────────────────────────

class TestSelfAuthenticatedRequestTool:
    def _make_tool(self, mock_agent=None, allow_http=False):
        from self_agent_sdk.langchain import SelfAuthenticatedRequestTool

        agent = mock_agent or MagicMock()
        return SelfAuthenticatedRequestTool(agent=agent, allow_http=allow_http), agent

    def test_makes_request_with_structured_args(self):
        tool, agent = self._make_tool()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.text = '{"ok":true}'
        agent.fetch.return_value = mock_resp

        result = json.loads(tool._run(
            url="https://example.com/api",
            method="POST",
            body={"key": "val"},
        ))
        assert result["status_code"] == 200
        agent.fetch.assert_called_once()
        call_args = agent.fetch.call_args
        assert call_args[0][0] == "https://example.com/api"
        assert call_args[1]["method"] == "POST"
        assert call_args[1]["body"] == '{"key": "val"}'

    def test_defaults_to_get(self):
        tool, agent = self._make_tool()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.text = "ok"
        agent.fetch.return_value = mock_resp

        tool._run(url="https://example.com/data")
        agent.fetch.assert_called_once_with(
            "https://example.com/data", method="GET", body=None,
            headers=None,
        )

    def test_returns_error_on_missing_url(self):
        tool, _ = self._make_tool()
        result = json.loads(tool._run(url=""))
        assert "error" in result

    def test_truncates_long_response_body(self):
        tool, agent = self._make_tool()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.text = "x" * 10000
        agent.fetch.return_value = mock_resp

        result = json.loads(tool._run(url="https://example.com"))
        assert len(result["body"]) == 4000

    def test_blocks_http_urls(self):
        tool, agent = self._make_tool()
        result = json.loads(tool._run(url="http://example.com/api"))
        assert "error" in result
        assert "HTTPS" in result["error"]
        agent.fetch.assert_not_called()

    def test_blocks_localhost(self):
        tool, agent = self._make_tool()
        result = json.loads(tool._run(url="https://localhost:8080/admin"))
        assert "error" in result
        assert "Blocked" in result["error"]
        agent.fetch.assert_not_called()

    def test_blocks_cloud_metadata(self):
        tool, agent = self._make_tool()
        result = json.loads(tool._run(url="https://169.254.169.254/latest/meta-data/"))
        assert "error" in result
        agent.fetch.assert_not_called()

    def test_blocks_private_ip(self):
        tool, agent = self._make_tool()
        result = json.loads(tool._run(url="https://10.0.0.1/internal"))
        assert "error" in result
        agent.fetch.assert_not_called()

    def test_allow_http_for_local_dev(self):
        tool, agent = self._make_tool(allow_http=True)
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.text = "ok"
        agent.fetch.return_value = mock_resp

        result = json.loads(tool._run(url="http://api.example.com/data"))
        assert result["status_code"] == 200

    def test_allow_http_still_blocks_private_ips(self):
        tool, agent = self._make_tool(allow_http=True)
        result = json.loads(tool._run(url="http://169.254.169.254/meta-data/"))
        assert "error" in result
        agent.fetch.assert_not_called()

    def test_returns_error_on_fetch_exception(self):
        tool, agent = self._make_tool()
        agent.fetch.side_effect = ConnectionError("timeout")

        result = json.loads(tool._run(url="https://example.com"))
        assert "error" in result
        assert "timeout" in result["error"]

    def test_arun_returns_same_as_run(self):
        tool, agent = self._make_tool()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.text = "ok"
        agent.fetch.return_value = mock_resp

        sync_result = tool._run(url="https://example.com")
        async_result = asyncio.run(tool._arun(url="https://example.com"))
        assert json.loads(sync_result)["status_code"] == json.loads(async_result)["status_code"]

    def test_has_args_schema(self):
        from self_agent_sdk.langchain import SelfAuthenticatedRequestTool, AuthenticatedRequestInput
        tool, _ = self._make_tool()
        assert tool.args_schema is AuthenticatedRequestInput


# ── SelfVerifyAgentTool ───────────────────────────────────────────────────

class TestSelfVerifyAgentTool:
    def _make_tool(self, mock_verifier=None):
        from self_agent_sdk.langchain import SelfVerifyAgentTool

        verifier = mock_verifier or MagicMock()
        return SelfVerifyAgentTool(verifier=verifier), verifier

    def test_verifies_valid_request(self):
        from self_agent_sdk.types import VerificationResult

        mock_result = VerificationResult(
            valid=True,
            agent_address="0xabc",
            agent_key=b"\x00" * 32,
            agent_id=5,
            agent_count=1,
        )
        mock_verifier = MagicMock()
        mock_verifier.verify.return_value = mock_result

        tool, _ = self._make_tool(mock_verifier)
        result = json.loads(tool._run(
            signature="0xsig",
            timestamp="1234567890",
            method="POST",
            url="https://example.com/api",
        ))
        assert result["valid"] is True
        assert result["agent_id"] == 5

    def test_passes_optional_keytype_and_agent_key(self):
        mock_verifier = MagicMock()
        mock_result = MagicMock()
        mock_result.valid = False
        mock_result.agent_address = ""
        mock_result.agent_id = 0
        mock_result.error = "not found"
        mock_verifier.verify.return_value = mock_result

        tool, _ = self._make_tool(mock_verifier)
        tool._run(
            signature="0xsig",
            timestamp="123",
            method="GET",
            url="https://example.com",
            keytype="ed25519",
            agent_key="0xpubkey",
        )
        call_kwargs = mock_verifier.verify.call_args[1]
        assert call_kwargs["keytype"] == "ed25519"
        assert call_kwargs["agent_key_hex"] == "0xpubkey"

    def test_returns_error_on_verify_exception(self):
        mock_verifier = MagicMock()
        mock_verifier.verify.side_effect = RuntimeError("contract call failed")

        tool, _ = self._make_tool(mock_verifier)
        result = json.loads(tool._run(
            signature="0xsig",
            timestamp="123",
            method="GET",
            url="https://example.com",
        ))
        assert "error" in result
        assert "contract call failed" in result["error"]

    def test_has_args_schema(self):
        from self_agent_sdk.langchain import SelfVerifyAgentTool, VerifyAgentInput
        tool, _ = self._make_tool()
        assert tool.args_schema is VerifyAgentInput


# ── SelfAgentInfoTool ─────────────────────────────────────────────────────

class TestSelfAgentInfoTool:
    def _make_tool(self):
        from self_agent_sdk.langchain import SelfAgentInfoTool
        return SelfAgentInfoTool()

    @patch("self_agent_sdk.langchain.Web3")
    def test_returns_verified_agent_info(self, MockWeb3):
        registry = MagicMock()
        instance = MagicMock()
        MockWeb3.return_value = instance
        MockWeb3.HTTPProvider.return_value = MagicMock()
        MockWeb3.to_checksum_address = lambda x: x
        instance.eth.contract.return_value = registry

        registry.functions.isVerifiedAgent.return_value.call.return_value = True
        registry.functions.getAgentId.return_value.call.return_value = 42

        tool = self._make_tool()
        result = json.loads(tool._run(
            agent_address="0x1234567890abcdef1234567890abcdef12345678",
        ))
        assert result["is_verified"] is True
        assert result["agent_id"] == 42

    @patch("self_agent_sdk.langchain.Web3")
    def test_returns_not_verified(self, MockWeb3):
        registry = MagicMock()
        instance = MagicMock()
        MockWeb3.return_value = instance
        MockWeb3.HTTPProvider.return_value = MagicMock()
        MockWeb3.to_checksum_address = lambda x: x
        instance.eth.contract.return_value = registry

        registry.functions.isVerifiedAgent.return_value.call.return_value = False

        tool = self._make_tool()
        result = json.loads(tool._run(
            agent_address="0x1234567890abcdef1234567890abcdef12345678",
        ))
        assert result["is_verified"] is False

    @patch("self_agent_sdk.langchain.Web3")
    def test_defaults_to_mainnet(self, MockWeb3):
        registry = MagicMock()
        instance = MagicMock()
        MockWeb3.return_value = instance
        MockWeb3.HTTPProvider.return_value = MagicMock()
        MockWeb3.to_checksum_address = lambda x: x
        instance.eth.contract.return_value = registry
        registry.functions.isVerifiedAgent.return_value.call.return_value = False

        tool = self._make_tool()
        result = json.loads(tool._run(
            agent_address="0x1234567890abcdef1234567890abcdef12345678",
        ))
        assert result["network"] == "mainnet"

    def test_returns_error_on_missing_address(self):
        tool = self._make_tool()
        result = json.loads(tool._run(agent_address=""))
        assert "error" in result

    def test_returns_error_on_unknown_network(self):
        tool = self._make_tool()
        result = json.loads(tool._run(
            agent_address="0x1234567890abcdef1234567890abcdef12345678",
            network="polygon",
        ))
        assert "error" in result
        assert "Unknown network" in result["error"]

    def test_has_args_schema(self):
        from self_agent_sdk.langchain import SelfAgentInfoTool, AgentInfoInput
        tool = self._make_tool()
        assert tool.args_schema is AgentInfoInput

    @patch("self_agent_sdk.langchain.Web3")
    def test_caches_registry_per_network(self, MockWeb3):
        registry = MagicMock()
        instance = MagicMock()
        MockWeb3.return_value = instance
        MockWeb3.HTTPProvider.return_value = MagicMock()
        MockWeb3.to_checksum_address = lambda x: x
        instance.eth.contract.return_value = registry
        registry.functions.isVerifiedAgent.return_value.call.return_value = False

        tool = self._make_tool()
        tool._run(agent_address="0x1234567890abcdef1234567890abcdef12345678")
        tool._run(agent_address="0x1234567890abcdef1234567890abcdef12345678")

        # Web3 constructor called only once (cached)
        assert MockWeb3.call_count == 1


# ── SelfAgentToolkit ──────────────────────────────────────────────────────

class TestSelfAgentToolkit:
    def test_agent_only_gives_request_and_info_tools(self):
        from self_agent_sdk.langchain import SelfAgentToolkit

        toolkit = SelfAgentToolkit(agent=MagicMock())
        tools = toolkit.get_tools()
        names = {t.name for t in tools}
        assert names == {"self_authenticated_request", "self_agent_info"}

    def test_verifier_only_gives_verify_and_info_tools(self):
        from self_agent_sdk.langchain import SelfAgentToolkit

        toolkit = SelfAgentToolkit(verifier=MagicMock())
        tools = toolkit.get_tools()
        names = {t.name for t in tools}
        assert names == {"self_verify_agent", "self_agent_info"}

    def test_both_gives_all_three_tools(self):
        from self_agent_sdk.langchain import SelfAgentToolkit

        toolkit = SelfAgentToolkit(agent=MagicMock(), verifier=MagicMock())
        tools = toolkit.get_tools()
        names = {t.name for t in tools}
        assert names == {"self_authenticated_request", "self_verify_agent", "self_agent_info"}

    def test_neither_gives_info_only(self):
        from self_agent_sdk.langchain import SelfAgentToolkit

        toolkit = SelfAgentToolkit()
        tools = toolkit.get_tools()
        names = {t.name for t in tools}
        assert names == {"self_agent_info"}

    def test_allow_http_propagates_to_request_tool(self):
        from self_agent_sdk.langchain import SelfAgentToolkit

        toolkit = SelfAgentToolkit(agent=MagicMock(), allow_http=True)
        tools = toolkit.get_tools()
        request_tool = [t for t in tools if t.name == "self_authenticated_request"][0]
        assert request_tool.allow_http is True
