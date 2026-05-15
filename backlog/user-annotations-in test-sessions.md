Once we will have the CLI in place for coding agent testing, we should add support for user annotations in test sessions.

The user in the UI when doing manual experiments should be able to add information, evaluation, and possible questions which the coding agent can find using the CLI and include in the evaluation of what worked or not.

This should allow for a more efficient collaboartion and evaluation loop where the human tester can easily flag things as satifactory or not and provide feedback the coding agent can use to better evaluate the performances of the LLM when it comes to interracting with the MCP server under test.

In addition to a annotation system with free text there could be a simple "star system" that allow the human user to classify successes and failures in a very quick and simple way. This combined with the assesement of the coding agent should allow for a more efficient and effective evaluation loop.
