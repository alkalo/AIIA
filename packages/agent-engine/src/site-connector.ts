import {
  OllamaClient,
  modelForProfile,
  GEMINI_FLASH,
  type LlmClient,
} from "@aiia/ollama-client/browser";

export type OllamaChatClient = LlmClient;

export interface SiteConnectionPlan {
  siteId: string;
  label: string;
  loginUrl: string;
  homeUrl?: string;
  authType: "form" | "session";
  hints: string;
}

const SYSTEM = `You help users connect AIIA (local search agent app) to websites securely.
Given a website or app name, return ONLY valid JSON:
{
  "siteId": "lowercase-slug-no-spaces",
  "label": "Display name",
  "loginUrl": "https://official-login-page-url",
  "homeUrl": "https://homepage-optional",
  "authType": "form",
  "hints": "Short instructions for the user in the requested language"
}
Use real official login URLs when known. authType is always "form" for username/password sites.`;

export class SiteConnectorAgent {
  private ollama: OllamaChatClient;
  private model: string;

  constructor(hwProfile = "medium", ollama?: OllamaChatClient) {
    this.ollama = ollama ?? new OllamaClient();
    this.model = modelForProfile(hwProfile, "planner");
  }

  async analyzeSite(siteName: string, lang: "en" | "es" = "es"): Promise<SiteConnectionPlan> {
    const models = await this.ollama.listModels().catch(() => [] as string[]);
    if (models.some((m) => m.startsWith("gemini"))) {
      this.model = GEMINI_FLASH;
    } else if (!models.some((m) => m.startsWith(this.model.split(":")[0]))) {
      await this.ollama.pullModel(this.model);
    }

    const response = await this.ollama.chat(
      [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: `Site/app name: ${siteName}\nLanguage for hints: ${lang === "es" ? "Spanish" : "English"}`,
        },
      ],
      { model: this.model, temperature: 0.2, format: "json", numCtx: 4096 }
    );

    let parsed: Partial<SiteConnectionPlan>;
    try {
      parsed = JSON.parse(response) as Partial<SiteConnectionPlan>;
    } catch {
      const match = response.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("IA no devolvió un plan válido");
      parsed = JSON.parse(match[0]) as Partial<SiteConnectionPlan>;
    }

    const slug =
      parsed.siteId ??
      siteName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

    if (!parsed.loginUrl) {
      throw new Error("No se pudo determinar la URL de inicio de sesión");
    }

    return {
      siteId: slug,
      label: parsed.label ?? siteName,
      loginUrl: parsed.loginUrl,
      homeUrl: parsed.homeUrl,
      authType: "form",
      hints:
        parsed.hints ??
        (lang === "es"
          ? "Introduce tu usuario y contraseña. La sesión se guardará cifrada solo en tu PC."
          : "Enter your username and password. The session will be encrypted locally on your PC."),
    };
  }
}
