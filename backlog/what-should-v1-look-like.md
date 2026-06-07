# Criteria / Ambition to release a V1

We want to release mcpscope as an opensource project.

For that we have to package what we can call a V1 with a simple and useful set of features.

We target developpers and ai enthousiasts who want to experiment with mcp servers and mcp server development. The core use-case is to allow experimenting with local AI models (LMStudio, Ollama) to help people undestand how the context work and how the llm actually picks tools and call them. The reason I built mcpscope in the first place was that I fealt that the built-in chat in LMStudio or other tools like OpenWebUI did not give me enough observability on the state of the context at all time. Working with locam model with small context windows from 8k to 64k means that context  management is very important.

## Features and Gaps

* LLM Provider support: Support for Ollama with full streaming and resonning like we have with LMStudio. Since Ollama and LMStudio are the most popular tools to run LLM locally it is good to have both in the V1. We have support for OpenRouter as well for remote LLM to complement but that is secondary and from tests it is not as easy to get the thinking and reasoning blocks. Being able to use bigger models for the analysis make sense and this is mostly where OpenRouter integration is useful. For the analysis, it is the result which is interesting, not the details of the session so the limitation in terms of observability does not matter. We could consider having also a standard OpenAI Connection option for other tools but we have to make sure that the standard part is enough for the basics.

* Session Analysis: We need to ship V1 with a couple of different analsyis strategies which can be used out of the box. Currently we have 3 difefrent ones which have mostly been created to test the framework. None of them is really good and efficient in finding 