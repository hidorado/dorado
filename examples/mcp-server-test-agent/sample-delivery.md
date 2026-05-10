# MCP Server Test Report — mcp-servers/everything v2.0.0

_Tested by Dorado MCP Server Test Agent · 2026-05-10T17:08:44.573Z_

## Summary
Tested **mcp-servers/everything** v2.0.0 (13 tools, 11.0s). 11/13 responded OK to empty-args call. 2 returned an error. No major issues flagged.

Resources advertised: **7** · Prompts advertised: **4** · Total runtime: **11.0s**.

## Tools tested
| Tool | Status | Duration | Notes |
|---|---|---|---|
| `echo` | ✓ ok | 1ms | Echoes back the input string |
| `get-annotated-message` | ✓ ok | 0ms | Demonstrates how annotations can be used to provide metadat… |
| `get-env` | ✓ ok | 1ms | Returns all environment variables, helpful for debugging MC… |
| `get-resource-links` | ✓ ok | 11ms | Returns up to ten resource links that reference different t… |
| `get-resource-reference` | ✓ ok | 1ms | Returns a resource reference that can be used by MCP clients |
| `get-structured-content` | ✓ ok | 0ms | Returns structured content along with an output schema for … |
| `get-sum` | ✓ ok | 1ms | Returns the sum of two numbers |
| `get-tiny-image` | ✓ ok | 0ms | Returns a tiny MCP logo image. |
| `gzip-file-as-resource` | ✓ ok | 113ms | Compresses a single file using gzip compression. Depending … |
| `toggle-simulated-logging` | ✓ ok | 1ms | Toggles simulated, random-leveled logging on or off. |
| `toggle-subscriber-updates` | ✓ ok | 0ms | Toggles simulated resource subscription updates on or off. |
| `trigger-long-running-operation` | ✗ error | 8001ms | callTool:trigger-long-running-operation timed out after 8000ms |
| `simulate-research-query` | ✗ -32600 | 1ms | MCP error -32600: Tool "simulate-research-query" requires task-based execution.… |

## Issues found
No issues flagged. Empty-args probe passed cleanly on every tool.

## Repro steps
```
Launch stdio server: `npx -y @modelcontextprotocol/server-everything`
Server instructions: "# Everything Server – Server Instructions

Audience: These instructions are written for an LLM or autonomous agent integ"

# As a one-liner via @dorado/example-mcp-server-test-agent:
MCP_COMMAND="npx -y @modelcontextprotocol/server-everything" pnpm start
```

## Tool catalogue (full)
### `echo`
Echoes back the input string

```json
{
  "type": "object",
  "properties": {
    "message": {
      "type": "string",
      "description": "Message to echo"
    }
  },
  "required": [
    "message"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```
_Sample result:_ `{"content":[{"type":"text","text":"MCP error -32602: Input validation error: Invalid arguments for tool echo: [\n  {\n    \"code\": \"invalid_type\",\n    \"ex…`

### `get-annotated-message`
Demonstrates how annotations can be used to provide metadata about content.

```json
{
  "type": "object",
  "properties": {
    "messageType": {
      "type": "string",
      "enum": [
        "error",
        "success",
        "debug"
      ],
      "description": "Type of message to demonstrate different annotation patterns"
    },
    "includeImage": {
      "type": "boolean",
      "default": false,
      "description": "Whether to include an example image"
    }
  },
  "required": [
    "messageType"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```
_Sample result:_ `{"content":[{"type":"text","text":"MCP error -32602: Input validation error: Invalid arguments for tool get-annotated-message: [\n  {\n    \"expected\": \"'err…`

### `get-env`
Returns all environment variables, helpful for debugging MCP server configuration

```json
{
  "type": "object",
  "properties": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```
_Sample result:_ `{"content":[{"type":"text","text":"{\n  \"NODE\": \"/opt/homebrew/Cellar/node/25.6.0/bin/node\",\n  \"INIT_CWD\": \"/private/tmp/hidorado-dorado-clone/examples…`

### `get-resource-links`
Returns up to ten resource links that reference different types of resources

```json
{
  "type": "object",
  "properties": {
    "count": {
      "type": "number",
      "minimum": 1,
      "maximum": 10,
      "default": 3,
      "description": "Number of resource links to return (1-10)"
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```
_Sample result:_ `{"content":[{"type":"text","text":"Here are 3 resource links to resources available in this server:"},{"name":"Blob Resource 1","uri":"demo://resource/dynamic/…`

### `get-resource-reference`
Returns a resource reference that can be used by MCP clients

```json
{
  "type": "object",
  "properties": {
    "resourceType": {
      "type": "string",
      "enum": [
        "Text",
        "Blob"
      ],
      "default": "Text"
    },
    "resourceId": {
      "type": "number",
      "default": 1,
      "description": "ID of the text resource to fetch"
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```
_Sample result:_ `{"content":[{"type":"text","text":"Returning resource reference for Resource 1:"},{"type":"resource","resource":{"uri":"demo://resource/dynamic/text/1","mimeTy…`

### `get-structured-content`
Returns structured content along with an output schema for client data validation

```json
{
  "type": "object",
  "properties": {
    "location": {
      "type": "string",
      "enum": [
        "New York",
        "Chicago",
        "Los Angeles"
      ],
      "description": "Choose city"
    }
  },
  "required": [
    "location"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```
_Sample result:_ `{"content":[{"type":"text","text":"MCP error -32602: Input validation error: Invalid arguments for tool get-structured-content: [\n  {\n    \"expected\": \"'Ne…`

### `get-sum`
Returns the sum of two numbers

```json
{
  "type": "object",
  "properties": {
    "a": {
      "type": "number",
      "description": "First number"
    },
    "b": {
      "type": "number",
      "description": "Second number"
    }
  },
  "required": [
    "a",
    "b"
  ],
  "additionalProperties": false,
