// Disable LangSmith tracing in tests — prevents 429 monthly quota errors
process.env.LANGSMITH_TRACING = 'false';
process.env.LANGCHAIN_TRACING_V2 = 'false';
