This builds on the idea of expose-api-for-auto-test.

The idea is to expose our test API via an MCP server so that it can be used by a coding agent which is developing, evaluating or testing the MCP server under test.

We need to avoid any confusion here. We are not talking about the MCP Server under test, but rather the MCP server that exposes the test API.

It is very likely that it is a testingn tuning or development agent which should be fine tuning the MCP server under test. Since there is a lot of natural language involved, a coding agent which is ajusting tool description and then running some test prompts and can access the conversation history with the reasonning and tool calls seem like a good way of iteratively tuning the MCP server under test.
