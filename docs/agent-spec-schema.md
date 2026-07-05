{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://aiia.local/agent-spec.json",
  "title": "AgentSpec",
  "type": "object",
  "required": ["id", "version", "name", "prompt", "search", "filters", "output", "schedule", "effort", "status"],
  "properties": {
    "id": { "type": "string", "format": "uuid" },
    "version": { "type": "integer", "minimum": 1 },
    "name": { "type": "string", "minLength": 1 },
    "prompt": { "type": "string", "minLength": 1 },
    "templateId": {
      "type": "string",
      "enum": ["job-search", "candidate-search", "supplier-search", "custom"]
    },
    "search": {
      "type": "object",
      "required": ["queries", "sources"],
      "properties": {
        "queries": { "type": "array", "items": { "type": "string" }, "minItems": 1 },
        "sources": {
          "type": "array",
          "items": {
            "oneOf": [
              { "type": "object", "properties": { "type": { "const": "duckduckgo" } }, "required": ["type"] },
              { "type": "object", "properties": { "type": { "const": "url" }, "url": { "type": "string", "format": "uri" } }, "required": ["type", "url"] }
            ]
          }
        },
        "requiresLogin": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "siteId": { "type": "string" },
              "credentialRef": { "type": "string" }
            },
            "required": ["siteId", "credentialRef"]
          }
        }
      }
    },
    "filters": {
      "type": "object",
      "required": ["criteria", "minScore"],
      "properties": {
        "criteria": { "type": "string" },
        "minScore": { "type": "number", "minimum": 0, "maximum": 100 },
        "dedupe": {
          "type": "object",
          "properties": {
            "enabled": { "type": "boolean" },
            "fields": { "type": "array", "items": { "type": "string" } }
          }
        }
      }
    },
    "output": {
      "type": "object",
      "required": ["schema", "destinations"],
      "properties": {
        "schema": { "type": "array", "items": { "type": "string" }, "minItems": 1 },
        "destinations": {
          "type": "array",
          "items": { "type": "string", "enum": ["inbox", "excel", "csv"] }
        },
        "excelPath": { "type": "string" },
        "excelMode": { "type": "string", "enum": ["new_file", "update_same"] },
        "notify": { "type": "boolean" }
      }
    },
    "schedule": {
      "type": "object",
      "required": ["intervalMinutes", "onlyWhenRunning"],
      "properties": {
        "intervalMinutes": { "type": "integer", "minimum": 15 },
        "onlyWhenRunning": { "type": "boolean" },
        "timezone": { "type": "string" }
      }
    },
    "effort": { "type": "string", "enum": ["low", "medium", "high", "super_high"] },
    "retentionDays": { "type": "integer", "minimum": 1, "default": 90 },
    "status": {
      "type": "string",
      "enum": ["draft", "pending_review", "published", "paused", "error"]
    }
  }
}
