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
      "enum": [
        "web-research",
        "opportunities",
        "people-orgs",
        "monitoring",
        "custom",
        "job-search",
        "candidate-search",
        "supplier-search"
      ]
    },
    "opportunitySubtype": {
      "type": "string",
      "enum": [
        "jobs",
        "grants",
        "programs",
        "awards",
        "exposure",
        "sector_news",
        "tenders",
        "events",
        "deals",
        "real_estate",
        "custom"
      ],
      "description": "jobs | funding(grants) | programs | awards | exposure | sector_news | …"
    },
    "contentMode": {
      "type": "string",
      "enum": ["auto", "opportunities", "sector_news", "wrap"],
      "description": "High-level curation mode; inferred when omitted"
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
              { "type": "object", "properties": { "type": { "const": "url" }, "url": { "type": "string", "format": "uri" } }, "required": ["type", "url"] },
              { "type": "object", "properties": { "type": { "const": "rss" }, "url": { "type": "string", "format": "uri" } }, "required": ["type", "url"] }
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
        },
        "maxSources": { "type": "integer", "minimum": 1 },
        "maxResultsPerQuery": { "type": "integer", "minimum": 1 }
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
        },
        "maxAgeDays": { "type": "integer", "minimum": 1, "description": "News freshness window" },
        "minDaysRemaining": { "type": "integer", "minimum": 0, "description": "Min days until opportunity deadline" },
        "requireVerification": { "type": "boolean" }
      }
    },
    "output": {
      "type": "object",
      "required": ["schema", "destinations"],
      "properties": {
        "schema": { "type": "array", "items": { "type": "string" }, "minItems": 1 },
        "destinations": {
          "type": "array",
          "items": { "type": "string", "enum": ["inbox", "excel", "csv", "email"] }
        },
        "excelPath": { "type": "string" },
        "excelMode": { "type": "string", "enum": ["new_file", "update_same"] },
        "notify": { "type": "boolean" },
        "emailTo": { "type": "string", "description": "Suggested To for copy-paste wrap (never auto-sent)" }
      }
    },
    "schedule": {
      "type": "object",
      "required": ["intervalMinutes", "onlyWhenRunning"],
      "properties": {
        "intervalMinutes": { "type": "integer", "minimum": 15 },
        "onlyWhenRunning": { "type": "boolean" },
        "cloudEnabled": {
          "type": "boolean",
          "description": "Gemini only: run on AIIA Cloud cron (PC can be off). Results sync when app opens."
        },
        "timezone": { "type": "string" }
      }
    },
    "effort": { "type": "string", "enum": ["low", "medium", "high", "super_high", "ultra_high"] },
    "retentionDays": { "type": "integer", "minimum": 1, "default": 90 },
    "status": {
      "type": "string",
      "enum": ["draft", "pending_review", "published", "paused", "error"]
    }
  }
}
