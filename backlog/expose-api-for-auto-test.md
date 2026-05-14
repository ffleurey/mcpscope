In mcpscope we provide a UI so that the developper can manually test the mcp server under development.

The idea of this feature is to provide an API that can be used by automated tests of the mcp server project to run experiments and validate the server's behavior with the llm in the loop.

The API should allow the test automation framework to provide the prompts to run, based on a test scenario and get back all the relevant inforamtion to check how the llm performed at choosing and using the tools of the mcp server under test.

The goal is to provide automatically the feedback and traces which are relevant to drive the improvement of the tool structure and description which make the best use of the context of the llm.

Probably a test/api configuration with the correct model to use should be visible in the mcp scope UI. This creates an "environment" that the test can use to run experiments.

The UI should allow exploring and following in real time the experiments run by the test automation framework.

Not sure what would be the best structure and technology for the API. This would have to be researched. 

We also have to research how people are actually testing MCP servers and if there are specific tools for test automation which we should be aware of or would be smart to interface with.

Also unsure is we should provide just the API or potentially a small SDK or library to make it easier for test automation frameworks to use the API.
