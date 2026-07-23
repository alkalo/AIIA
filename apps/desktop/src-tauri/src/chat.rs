use std::time::Duration;

use aiia_core::models::{
    AgentSpec, AgentStatus, DedupeConfig, EffortLevel, ExcelMode, FilterConfig, OutputConfig,
    ScheduleConfig, SearchConfig, SearchSource,
};
use regex::Regex;
use serde::Serialize;
use uuid::Uuid;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WebSearchHit {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

pub async fn web_search(query: &str, limit: usize) -> Result<Vec<WebSearchHit>, String> {
    web_search_with_depth(query, limit, "eficaz", None).await
}

/// Approximate calendar year from UNIX time (good enough for search query hints).
fn recent_year_pair() -> (i32, i32) {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let year = 1970 + (secs / 31_557_600) as i32;
    (year.saturating_sub(1), year)
}

fn is_junk_result_url(url: &str) -> bool {
    let u = url.to_lowercase();
    u.contains("duckduckgo.com/y.js")
        || u.contains("bing.com/aclick")
        || u.contains("googleadservices.com")
        || u.contains("doubleclick.net")
        || u.contains("javascript:")
        || u.starts_with("about:")
}

fn is_usable_hit(url: &str, title: &str) -> bool {
    url.starts_with("http") && !is_junk_result_url(url) && title.trim().len() >= 2
}

fn looks_like_opportunity_search(q: &str) -> bool {
    let l = q.to_lowercase();
    [
        "oferta",
        "empleo",
        "vacante",
        "trabajo",
        "job",
        "jobs",
        "hiring",
        "remote",
        "remoto",
        "qa ",
        "qa lead",
        "qa tester",
        "tester",
        "developer",
        "engineer",
        "linkedin",
        "infojobs",
        "indeed",
        "glassdoor",
        "becario",
        "contrato",
        "videojuego",
        "gamedev",
        "gaming",
    ]
    .iter()
    .any(|k| l.contains(k))
}

/// Short keyword blob for job-board deep links (role + domain, not the full sentence).
fn opportunity_keywords(query: &str) -> String {
    let l = query.to_lowercase();
    let mut bits: Vec<&str> = Vec::new();

    if l.contains("qa lead") {
        bits.push("QA Lead");
    } else if l.contains("qa tester")
        || l.contains("quality assurance")
        || l.contains("qa ")
        || l.ends_with("qa")
    {
        if l.contains("senior") {
            bits.push("Senior QA Tester");
        } else {
            bits.push("QA Tester");
        }
    } else if l.contains("tester") || l.contains("testing") {
        bits.push("QA Tester");
    }

    if looks_like_gaming_job_search(query) {
        bits.push("games");
    }
    if l.contains("remoto") || l.contains("remote") || l.contains("teletrabajo") {
        bits.push("remote");
    }
    if l.contains("españa") || l.contains("spain") {
        bits.push("Spain");
    }

    if bits.len() >= 2 {
        return bits.join(" ");
    }
    if !bits.is_empty() {
        return bits.join(" ");
    }

    let cleaned = query
        .replace("Busca en la web", "")
        .replace("busca en la web", "")
        .replace("Busca", "")
        .replace("busca", "")
        .replace("ofertas", "")
        .replace("oferta", "")
        .replace("empleo", "")
        .replace("jobs", "")
        .replace("job", "")
        .trim()
        .to_string();
    if cleaned.is_empty() {
        query.trim().to_string()
    } else {
        cleaned
    }
}

/// Portal entry points so job searches never return "nothing online" when SERP is blocked.
fn opportunity_portal_seeds(query: &str) -> Vec<WebSearchHit> {
    let keywords = opportunity_keywords(query);
    let enc = urlencoding_encode(&keywords);
    let enc_es = urlencoding_encode(
        &keywords
            .replace("remote", "remoto")
            .replace("Spain", "España")
            .replace("spain", "España"),
    );
    let gaming = looks_like_gaming_job_search(query);
    let mut seeds = Vec::new();
    if gaming {
        seeds.extend([
            WebSearchHit {
                title: format!("Hitmarker — {keywords}"),
                url: format!("https://hitmarker.net/jobs?keyword={enc}"),
                snippet: "Portal Hitmarker (game industry). Open in browser.".to_string(),
            },
            WebSearchHit {
                title: format!("Remote Game Jobs — {keywords}"),
                url: format!("https://remotegamejobs.com/?s={enc}"),
                snippet: "Portal Remote Game Jobs.".to_string(),
            },
            WebSearchHit {
                title: format!("Games Jobs Direct — {keywords}"),
                url: format!("https://www.gamesjobsdirect.com/jobs?keywords={enc}"),
                snippet: "Portal Games Jobs Direct.".to_string(),
            },
            WebSearchHit {
                title: format!("Work With Indies — {keywords}"),
                url: format!("https://workwithindies.com/?s={enc}"),
                snippet: "Portal Work With Indies.".to_string(),
            },
        ]);
    }
    seeds.extend([
        WebSearchHit {
            title: format!("LinkedIn Jobs — {keywords} (Spain · Remote)"),
            url: format!(
                "https://www.linkedin.com/jobs/search/?keywords={enc}&location=Spain&f_WT=2"
            ),
            snippet: "Portal LinkedIn: open this search in your browser (login if needed)."
                .to_string(),
        },
        WebSearchHit {
            title: format!("InfoJobs — {keywords}"),
            url: format!(
                "https://www.infojobs.net/jobsearch/search-results/list.xhtml?keyword={enc_es}"
            ),
            snippet: "Portal InfoJobs España.".to_string(),
        },
        WebSearchHit {
            title: format!("Indeed España — {keywords}"),
            url: format!("https://es.indeed.com/jobs?q={enc}&l=Espa%C3%B1a"),
            snippet: "Portal Indeed España.".to_string(),
        },
        WebSearchHit {
            title: format!("Remote OK — {keywords}"),
            url: format!("https://remoteok.com/remote-jobs?search={enc}"),
            snippet: "Portal Remote OK (global remote).".to_string(),
        },
        WebSearchHit {
            title: format!("We Work Remotely — {keywords}"),
            url: format!("https://weworkremotely.com/remote-jobs/search?term={enc}"),
            snippet: "Portal We Work Remotely.".to_string(),
        },
        WebSearchHit {
            title: format!("Jooble España — {keywords}"),
            url: format!("https://es.jooble.org/SearchResult?ukw={enc}"),
            snippet: "Portal Jooble España (aggregator).".to_string(),
        },
        WebSearchHit {
            title: format!("Tecnoempleo — {keywords}"),
            url: format!("https://www.tecnoempleo.com/busqueda-empleo.php?te={enc_es}"),
            snippet: "Portal Tecnoempleo (IT jobs Spain).".to_string(),
        },
    ]);
    seeds
}

fn looks_like_gaming_job_search(q: &str) -> bool {
    let l = q.to_lowercase();
    [
        "videojuego",
        "videojuegos",
        "video game",
        "videogame",
        "gamedev",
        "gaming",
        "hitmarker",
        "unity",
        "unreal",
    ]
    .iter()
    .any(|k| l.contains(k))
}

fn expand_search_queries(query: &str, depth: &str) -> Vec<String> {
    let (y0, y1) = recent_year_pair();
    let mut qs = vec![query.to_string()];
    match depth {
        "instant" => {}
        "pro" => {
            qs.push(format!("{query} {y0} OR {y1}"));
            qs.push(format!("{query} overview analysis"));
        }
        "max" => {
            qs.push(format!("{query} {y0} OR {y1}"));
            qs.push(format!("{query} overview analysis review"));
            qs.push(format!("{query} primary source documentation"));
            qs.push(format!("{query} comparison alternatives"));
        }
        _ => {
            // eficaz: at least one alternate phrasing
            qs.push(format!("{query} details"));
            qs.push(format!("{query} {y1}"));
        }
    }

    if looks_like_opportunity_search(query) {
        // Broaden job/opportunity coverage across portals and languages.
        qs.push(format!("{query} site:linkedin.com/jobs"));
        qs.push(format!("{query} site:infojobs.net"));
        qs.push(format!("{query} site:indeed.com"));
        qs.push(format!("{query} site:glassdoor.com"));
        qs.push(format!("{query} site:remoteok.com OR site:weworkremotely.com"));
        // Common ES↔EN swaps for Spanish job queries
        let en = query
            .replace("ofertas", "jobs")
            .replace("oferta", "job")
            .replace("remoto", "remote")
            .replace("España", "Spain")
            .replace("españa", "Spain")
            .replace("Busca en la web", "")
            .replace("busca en la web", "")
            .replace("Busca", "")
            .replace("busca", "");
        let en = en.trim();
        if !en.is_empty() && en.to_lowercase() != query.to_lowercase() {
            qs.push(en.to_string());
            qs.push(format!("{en} site:linkedin.com/jobs"));
        }
        if query.to_lowercase().contains("qa") {
            qs.push("QA Lead remote Spain OR \"Quality Assurance\" Lead remote Spain".to_string());
            qs.push("\"QA Lead\" OR \"Test Lead\" remote Spain jobs".to_string());
        }
    }

    // Dedupe while preserving order
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for q in qs {
        let key = q.trim().to_lowercase();
        if key.is_empty() || !seen.insert(key) {
            continue;
        }
        out.push(q.trim().to_string());
    }
    out
}

async fn search_engines_for_depth(
    client: &reqwest::Client,
    query: &str,
    limit: usize,
    depth: &str,
    brave_api_key: Option<&str>,
) -> Vec<WebSearchHit> {
    let mut all = Vec::new();
    match depth {
        "instant" => {
            if let Some(key) = brave_api_key {
                if let Ok(hits) = search_brave_api(client, query, limit, key).await {
                    if !hits.is_empty() {
                        all.extend(hits);
                        return all;
                    }
                }
            }
            if let Ok(hits) = search_ddg(client, query, limit).await {
                all.extend(hits);
            }
        }
        "pro" | "max" => {
            let (a, b, c, d) = tokio::join!(
                search_ddg(client, query, limit),
                search_bing(client, query, limit),
                search_brave(client, query, limit, brave_api_key),
                search_mojeek(client, query, limit),
            );
            for r in [a, b, c, d] {
                if let Ok(hits) = r {
                    all.extend(hits);
                }
            }
        }
        _ => {
            // eficaz: prefer Brave API when available, else multi-engine HTML
            if let Some(key) = brave_api_key {
                if let Ok(hits) = search_brave_api(client, query, limit, key).await {
                    if !hits.is_empty() {
                        all.extend(hits);
                    }
                }
            }
            let (a, b, c) = tokio::join!(
                search_ddg(client, query, limit),
                search_bing(client, query, limit),
                search_mojeek(client, query, limit),
            );
            for r in [a, b, c] {
                if let Ok(hits) = r {
                    all.extend(hits);
                }
            }
        }
    }
    all
}

/// depth: `instant` | `eficaz` | `pro` | `max`
pub async fn web_search_with_depth(
    query: &str,
    limit: usize,
    depth: &str,
    brave_api_key: Option<&str>,
) -> Result<Vec<WebSearchHit>, String> {
    let opp = looks_like_opportunity_search(query);
    // Opportunity searches already have portal seeds — keep SERP short so the UI isn't stuck.
    let http_timeout = if opp {
        Duration::from_secs(8)
    } else {
        Duration::from_secs(20)
    };
    let client = reqwest::Client::builder()
        .timeout(http_timeout)
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        )
        .build()
        .map_err(|e| e.to_string())?;

    let mut all = Vec::new();
    let mut seen = std::collections::HashSet::new();

    // Job/listing: inject portals FIRST so coverage is instant even if SERP is blocked.
    if opp {
        for seed in opportunity_portal_seeds(query) {
            let key = seed.url.trim().trim_end_matches('/').to_lowercase();
            if key.is_empty() || !seen.insert(key) {
                continue;
            }
            all.push(seed);
        }
    }

    let queries = expand_search_queries(query, depth);
    // Keep SERP enrichment bounded — portals already guarantee coverage.
    let query_budget = if opp {
        if depth == "max" {
            2
        } else {
            1
        }
    } else if depth == "instant" {
        1
    } else {
        queries.len()
    };
    let target_organic = if opp { 4 } else { limit.max(8) };
    let mut organic = 0usize;

    for q in queries.into_iter().take(query_budget) {
        let engine_depth = if opp {
            // One multi-engine pass is enough; seeds already cover portals.
            if depth == "instant" {
                "eficaz"
            } else {
                "pro"
            }
        } else {
            depth
        };
        for h in search_engines_for_depth(&client, &q, limit, engine_depth, brave_api_key).await {
            if !is_usable_hit(&h.url, &h.title) {
                continue;
            }
            let key = h.url.trim().trim_end_matches('/').to_lowercase();
            if key.is_empty() || !seen.insert(key) {
                continue;
            }
            // Insert organics before portal seeds.
            if opp && h.snippet.starts_with("Portal") {
                all.push(h);
            } else {
                let insert_at = all
                    .iter()
                    .position(|x| x.snippet.starts_with("Portal"))
                    .unwrap_or(all.len());
                all.insert(insert_at, h);
                organic += 1;
            }
        }
        if depth == "instant" || organic >= target_organic {
            break;
        }
    }

    // Extra SERP pass only for non-opportunity thin results (opp already has portals).
    if !opp && organic < 2 && depth != "instant" {
        let fallbacks = [
            format!("{query} jobs"),
            format!("{query} site:linkedin.com/jobs"),
        ];
        for q in fallbacks {
            for h in search_engines_for_depth(&client, &q, limit, "pro", brave_api_key).await {
                if !is_usable_hit(&h.url, &h.title) {
                    continue;
                }
                let key = h.url.trim().trim_end_matches('/').to_lowercase();
                if key.is_empty() || !seen.insert(key) {
                    continue;
                }
                all.push(h);
                organic += 1;
            }
            if organic >= 4 {
                break;
            }
        }
    }

    let cap = match depth {
        "max" => limit.max(1).saturating_mul(3).max(limit),
        "pro" => limit.max(1).saturating_mul(2).max(limit),
        _ => limit.max(1).saturating_mul(if opp { 2 } else { 1 }).max(limit),
    };
    Ok(all.into_iter().take(cap.max(if opp { 8 } else { 1 })).collect())
}

async fn search_mojeek(
    client: &reqwest::Client,
    query: &str,
    limit: usize,
) -> Result<Vec<WebSearchHit>, String> {
    let url = format!(
        "https://www.mojeek.com/search?q={}",
        urlencoding_encode(query)
    );
    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Mojeek HTTP {}", res.status().as_u16()));
    }
    let html = res.text().await.map_err(|e| e.to_string())?;
    Ok(parse_mojeek_html(&html, limit))
}

fn parse_mojeek_html(html: &str, limit: usize) -> Vec<WebSearchHit> {
    let mut hits = Vec::new();
    let Ok(re) = Regex::new(
        r#"(?s)<(?:li|div)[^>]*class="[^"]*results-standard[^"]*"[^>]*>.*?<a[^>]+href="(https?://[^"]+)"[^>]*class="[^"]*title[^"]*"[^>]*>(.*?)</a>"#,
    ) else {
        return hits;
    };
    for cap in re.captures_iter(html).take(limit) {
        let url = cap.get(1).map(|m| m.as_str()).unwrap_or("").to_string();
        let title = strip_html(cap.get(2).map(|m| m.as_str()).unwrap_or(""));
        if url.starts_with("http") && title.len() > 2 {
            hits.push(WebSearchHit {
                title,
                url,
                snippet: String::new(),
            });
        }
    }
    // Fallback looser parse
    if hits.is_empty() {
        if let Ok(re2) = Regex::new(r#"href="(https?://(?!www\.mojeek\.com)[^"]+)"[^>]*>([^<]{8,120})"#) {
            for cap in re2.captures_iter(html).take(limit * 2) {
                let url = cap.get(1).map(|m| m.as_str()).unwrap_or("").to_string();
                let title = strip_html(cap.get(2).map(|m| m.as_str()).unwrap_or(""));
                if url.starts_with("http") && title.len() > 5 {
                    hits.push(WebSearchHit {
                        title,
                        url,
                        snippet: String::new(),
                    });
                }
                if hits.len() >= limit {
                    break;
                }
            }
        }
    }
    hits
}

async fn search_ddg(
    client: &reqwest::Client,
    query: &str,
    limit: usize,
) -> Result<Vec<WebSearchHit>, String> {
    let url = format!(
        "https://html.duckduckgo.com/html/?q={}",
        urlencoding_encode(query)
    );
    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        // Fall through to lite
    } else {
        let html = res.text().await.map_err(|e| e.to_string())?;
        let hits = parse_ddg_html(&html, limit);
        if !hits.is_empty() {
            return Ok(hits);
        }
    }

    let lite = format!(
        "https://lite.duckduckgo.com/lite/?q={}",
        urlencoding_encode(query)
    );
    let res = client.get(&lite).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Search failed HTTP {}", res.status().as_u16()));
    }
    let html = res.text().await.map_err(|e| e.to_string())?;
    Ok(parse_ddg_html(&html, limit))
}

async fn search_bing(
    client: &reqwest::Client,
    query: &str,
    limit: usize,
) -> Result<Vec<WebSearchHit>, String> {
    let url = format!(
        "https://www.bing.com/search?q={}",
        urlencoding_encode(query)
    );
    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Bing HTTP {}", res.status().as_u16()));
    }
    let html = res.text().await.map_err(|e| e.to_string())?;
    Ok(parse_bing_html(&html, limit))
}

async fn search_brave(
    client: &reqwest::Client,
    query: &str,
    limit: usize,
    api_key: Option<&str>,
) -> Result<Vec<WebSearchHit>, String> {
    if let Some(key) = api_key {
        if let Ok(hits) = search_brave_api(client, query, limit, key).await {
            if !hits.is_empty() {
                return Ok(hits);
            }
        }
    }
    let url = format!(
        "https://search.brave.com/search?q={}",
        urlencoding_encode(query)
    );
    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Brave HTTP {}", res.status().as_u16()));
    }
    let html = res.text().await.map_err(|e| e.to_string())?;
    Ok(parse_brave_html(&html, limit))
}

async fn search_brave_api(
    client: &reqwest::Client,
    query: &str,
    limit: usize,
    api_key: &str,
) -> Result<Vec<WebSearchHit>, String> {
    let count = limit.clamp(1, 20);
    let url = format!(
        "https://api.search.brave.com/res/v1/web/search?q={}&count={}",
        urlencoding_encode(query),
        count
    );
    let res = client
        .get(&url)
        .header("Accept", "application/json")
        .header("X-Subscription-Token", api_key)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    if status == 401 || status == 403 {
        return Err("Brave API unauthorized".to_string());
    }
    if !res.status().is_success() {
        return Err(format!("Brave API HTTP {status}"));
    }
    let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let mut hits = Vec::new();
    if let Some(arr) = body
        .get("web")
        .and_then(|w| w.get("results"))
        .and_then(|r| r.as_array())
    {
        for item in arr {
            let title = item
                .get("title")
                .and_then(|t| t.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            let url = item
                .get("url")
                .and_then(|u| u.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            let snippet = item
                .get("description")
                .and_then(|d| d.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            if title.len() >= 2 && url.starts_with("http") {
                hits.push(WebSearchHit {
                    title,
                    url,
                    snippet,
                });
            }
            if hits.len() >= limit {
                break;
            }
        }
    }
    Ok(hits)
}

#[allow(dead_code)]
fn dedupe_hits(hits: Vec<WebSearchHit>, limit: usize) -> Vec<WebSearchHit> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for h in hits {
        let key = h.url.trim().trim_end_matches('/').to_lowercase();
        if key.is_empty() || !seen.insert(key) {
            continue;
        }
        out.push(h);
        if out.len() >= limit {
            break;
        }
    }
    out
}

pub async fn fetch_url_text(url: &str, max_chars: usize) -> Result<String, String> {
    // Job boards almost always block headless fetch — return a browser hint instead of HTTP 403 noise.
    if is_anti_bot_job_board(url) {
        return Ok(format!(
            "Job board URL (scraping usually blocked): {url}\n\
Open this link in a browser (login if needed). Do NOT narrate HTTP errors; the URL itself is the deliverable."
        ));
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(45))
        .user_agent("Mozilla/5.0 (compatible; AIIA/1.0; +local)")
        .build()
        .map_err(|e| e.to_string())?;

    let res = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Fetch failed HTTP {}", res.status().as_u16()));
    }
    let html = res.text().await.map_err(|e| e.to_string())?;
    let text = strip_html(&html);
    if text.len() > max_chars {
        Ok(format!("{}…", &text[..max_chars]))
    } else {
        Ok(text)
    }
}

fn is_anti_bot_job_board(url: &str) -> bool {
    let l = url.to_lowercase();
    [
        "linkedin.com",
        "indeed.com",
        "infojobs.net",
        "remoteok.com",
        "weworkremotely.com",
        "jooble.org",
        "tecnoempleo.com",
        "glassdoor.com",
        "hitmarker.net",
        "remotegamejobs.com",
        "gamesjobsdirect.com",
        "workwithindies.com",
    ]
    .iter()
    .any(|h| l.contains(h))
}

pub fn draft_agent_from_prompt(name: &str, prompt: &str) -> AgentSpec {
    let id = Uuid::new_v4().to_string();
    AgentSpec {
        id,
        version: 1,
        name: if name.trim().is_empty() {
            "Agent from chat".to_string()
        } else {
            name.trim().to_string()
        },
        prompt: prompt.to_string(),
        template_id: Some("custom".to_string()),
        opportunity_subtype: None,
        content_mode: None,
        context_attachments: None,
        search: SearchConfig {
            queries: vec![prompt.chars().take(120).collect()],
            sources: vec![SearchSource::Duckduckgo],
            requires_login: vec![],
            max_sources: None,
            max_results_per_query: Some(20),
        },
        filters: FilterConfig {
            criteria: prompt.to_string(),
            min_score: 50.0,
            dedupe: DedupeConfig {
                enabled: true,
                fields: vec!["title".to_string(), "url".to_string()],
            },
            max_age_days: None,
            min_days_remaining: None,
            require_verification: None,
        },
        output: OutputConfig {
            schema: vec![
                "title".to_string(),
                "url".to_string(),
                "summary".to_string(),
            ],
            destinations: vec!["inbox".to_string(), "excel".to_string()],
            excel_path: None,
            excel_mode: ExcelMode::UpdateSame,
            notify: true,
            email_to: None,
        },
        schedule: ScheduleConfig {
            interval_minutes: 1440,
            only_when_running: true,
            cloud_enabled: false,
            timezone: "UTC".to_string(),
        },
        effort: EffortLevel::Medium,
        retention_days: 90,
        status: AgentStatus::Draft,
    }
}

pub const CHAT_SYSTEM_PROMPT: &str = r#"You are AIIA Chat, the assistant inside the AIIA desktop app.
You run on the user's PC. Prefer local AI (Ollama) when that mode is active; when Gemini mode is active you use the user's own Gemini API key. Reply in the same language as the user's latest message.
Be helpful, clear, and thorough when the user asks you to search or research. You can see images the user attaches.

You can use tools by emitting exactly one of these tags when needed (no other text inside the tag):
<tool name="web_search">{"query":"..."}</tool>
<tool name="fetch_url">{"url":"..."}</tool>
<tool name="create_agent">{"name":"...","prompt":"..."}</tool>
<tool name="generate_image">{"prompt":"..."}</tool>
<tool name="run_python">{"code":"..."}</tool>

## Web search rules (critical)
- If the user asks to search, find, list, monitor, or check anything on the web (jobs, prices, news, companies, docs…): you MUST call web_search before answering.
- Never claim “there are no results / no offers / nothing online” after a single empty or thin search.
- Improvise query variants: other language (ES↔EN), synonyms, site:linkedin.com/jobs, site:infojobs.net, site:indeed.com, site:hitmarker.net (games jobs), “remote Spain”, role synonyms (QA Tester / Quality Assurance / Test Lead).
- Job boards often block bots (HTTP 403). That is normal. Do NOT narrate fetch failures, “strategies”, or “please wait while I search again”. Give the user the portal search URLs to open in a browser.
- When portal links are already in the tool result, surface those URLs immediately as the answer (title + URL). Prefer that over scraping.
- Prefer concrete titles + URLs over vague market commentary. Do not invent job offers.
- Reply in the same language as the user's latest message.

Use create_agent when the user wants a recurring search/collection agent.
Use generate_image when the user asks to create/draw an image (requires local Automatic1111/Forge on port 7860).
Use run_python for short calculations or data transforms (local, timed out; no network assumptions).
After a tool result is provided, continue the answer for the user."#;

pub fn system_prompt_with_mode(mode_addon: Option<&str>) -> String {
    match mode_addon {
        Some(addon) if !addon.trim().is_empty() => {
            format!("{}\n\n{}", CHAT_SYSTEM_PROMPT, addon.trim())
        }
        _ => CHAT_SYSTEM_PROMPT.to_string(),
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedImage {
    pub path: String,
    pub prompt: String,
}

/// Local txt2img via Automatic1111 / Forge / compatible API on localhost:7860.
pub async fn generate_image(prompt: &str, out_dir: &std::path::Path) -> Result<GeneratedImage, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())?;

    let endpoints = [
        "http://127.0.0.1:7860/sdapi/v1/txt2img",
        "http://127.0.0.1:7861/sdapi/v1/txt2img",
    ];

    let body = serde_json::json!({
        "prompt": prompt,
        "negative_prompt": "blurry, low quality, watermark, text",
        "steps": 20,
        "width": 512,
        "height": 512,
        "cfg_scale": 7,
    });

    let mut last_err = "No local image API found on :7860/:7861 (start Automatic1111 or Forge).".to_string();
    for url in endpoints {
        match client.post(url).json(&body).send().await {
            Ok(res) if res.status().is_success() => {
                let data: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
                let b64 = data
                    .pointer("/images/0")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "Image API returned no image data".to_string())?;
                let bytes = b64_decode(b64)?;
                std::fs::create_dir_all(out_dir).map_err(|e| e.to_string())?;
                let name = format!("gen-{}.png", &Uuid::new_v4().to_string()[..8]);
                let path = out_dir.join(&name);
                std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
                return Ok(GeneratedImage {
                    path: path.to_string_lossy().to_string(),
                    prompt: prompt.to_string(),
                });
            }
            Ok(res) => {
                last_err = format!("Image API HTTP {}", res.status().as_u16());
            }
            Err(e) => {
                last_err = format!("Image API unreachable ({e}). Start Automatic1111/Forge with --api.");
            }
        }
    }
    Err(last_err)
}

fn b64_decode(s: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    // A1111 may return raw base64 or data URL
    let raw = s.split(',').next_back().unwrap_or(s);
    base64::engine::general_purpose::STANDARD
        .decode(raw)
        .map_err(|e| format!("Invalid base64 image: {e}"))
}

/// Run a short Python snippet locally with a hard timeout. Not a full sandbox.
pub fn run_python(code: &str, timeout_secs: u64) -> Result<String, String> {
    let forbidden = [
        "subprocess",
        "os.system",
        "socket",
        "urllib",
        "requests",
        "http.client",
        "ctypes",
        "multiprocessing",
        "__import__('os')",
    ];
    let lower = code.to_lowercase();
    for f in forbidden {
        if lower.contains(f) {
            return Err(format!("Blocked for safety: `{f}` is not allowed in run_python."));
        }
    }
    if code.len() > 8_000 {
        return Err("Code too long (max 8000 chars).".to_string());
    }

    let dir = std::env::temp_dir().join(format!("aiia-py-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let script = dir.join("snippet.py");
    std::fs::write(&script, code).map_err(|e| e.to_string())?;

    let py_cmds: &[&[&str]] = &[
        &["py", "-3"],
        &["python3"],
        &["python"],
    ];

    let mut last_err = "Python not found on PATH.".to_string();
    for cmd in py_cmds {
        let mut c = std::process::Command::new(cmd[0]);
        for a in &cmd[1..] {
            c.arg(a);
        }
        c.arg(&script);
        c.current_dir(&dir);
        c.env("PYTHONIOENCODING", "utf-8");
        // Best-effort: no proxy hints
        c.env_remove("HTTP_PROXY");
        c.env_remove("HTTPS_PROXY");

        match run_with_timeout(c, timeout_secs) {
            Ok(out) => {
                let _ = std::fs::remove_dir_all(&dir);
                return Ok(out);
            }
            Err(e) => {
                last_err = e;
                if !last_err.contains("not found") && !last_err.contains("os error 2") {
                    let _ = std::fs::remove_dir_all(&dir);
                    return Err(last_err);
                }
            }
        }
    }
    let _ = std::fs::remove_dir_all(&dir);
    Err(last_err)
}

fn run_with_timeout(mut cmd: std::process::Command, timeout_secs: u64) -> Result<String, String> {
    use std::io::Read;
    use std::process::Stdio;

    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "Python not found on PATH.".to_string()
        } else {
            e.to_string()
        }
    })?;

    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let mut stdout = String::new();
                let mut stderr = String::new();
                if let Some(mut out) = child.stdout.take() {
                    let _ = out.read_to_string(&mut stdout);
                }
                if let Some(mut err) = child.stderr.take() {
                    let _ = err.read_to_string(&mut stderr);
                }
                let mut combined = stdout;
                if !stderr.trim().is_empty() {
                    if !combined.is_empty() {
                        combined.push_str("\n");
                    }
                    combined.push_str(&stderr);
                }
                if !status.success() && combined.trim().is_empty() {
                    return Err(format!("Python exited with {status}"));
                }
                if combined.len() > 20_000 {
                    combined.truncate(20_000);
                    combined.push_str("\n…(truncated)");
                }
                return Ok(if combined.trim().is_empty() {
                    "(no output)".to_string()
                } else {
                    combined
                });
            }
            Ok(None) => {
                if start.elapsed().as_secs() >= timeout_secs {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!("Python timed out after {timeout_secs}s"));
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}

fn urlencoding_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn parse_bing_html(html: &str, limit: usize) -> Vec<WebSearchHit> {
    let mut hits = Vec::new();
    let Ok(re) = Regex::new(
        r#"(?s)<li class="b_algo".*?<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>"#,
    ) else {
        return hits;
    };
    for cap in re.captures_iter(html).take(limit * 2) {
        let raw = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        let url = decode_bing_redirect(raw);
        let title = strip_html(cap.get(2).map(|m| m.as_str()).unwrap_or(""));
        if is_usable_hit(&url, &title) {
            hits.push(WebSearchHit {
                title,
                url,
                snippet: String::new(),
            });
        }
        if hits.len() >= limit {
            break;
        }
    }
    hits
}

/// Bing wraps destinations as /ck/a?...&u=a1BASE64...
fn decode_bing_redirect(href: &str) -> String {
    let href = href.replace("&amp;", "&");
    if let Some(idx) = href.find("u=a1") {
        let rest = &href[idx + 4..];
        let b64 = rest.split('&').next().unwrap_or(rest);
        if let Ok(bytes) = base64_decode_url(b64) {
            if let Ok(s) = String::from_utf8(bytes) {
                if s.starts_with("http") {
                    return s;
                }
            }
        }
    }
    if href.starts_with("http") && !href.contains("bing.com/ck/") {
        return href.to_string();
    }
    String::new()
}

fn base64_decode_url(s: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    let padded = match s.len() % 4 {
        2 => format!("{s}=="),
        3 => format!("{s}="),
        _ => s.to_string(),
    };
    base64::engine::general_purpose::STANDARD
        .decode(padded.as_bytes())
        .or_else(|_| base64::engine::general_purpose::URL_SAFE.decode(padded.as_bytes()))
        .map_err(|e| e.to_string())
}

fn parse_brave_html(html: &str, limit: usize) -> Vec<WebSearchHit> {
    let mut hits = Vec::new();
    let Ok(re) = Regex::new(
        r#"<a[^>]+href="(https?://(?!cdn\.|search\.brave)[^"]+)"[^>]*(?:class="[^"]*(?:title|result)[^"]*")?[^>]*>(.*?)</a>"#,
    ) else {
        return hits;
    };
    for cap in re.captures_iter(html).take(limit * 3) {
        let url = cap.get(1).map(|m| m.as_str()).unwrap_or("").to_string();
        let title = strip_html(cap.get(2).map(|m| m.as_str()).unwrap_or(""));
        if !url.starts_with("http") || title.len() < 3 {
            continue;
        }
        hits.push(WebSearchHit {
            title,
            url,
            snippet: String::new(),
        });
        if hits.len() >= limit {
            break;
        }
    }
    hits
}

fn parse_ddg_html(html: &str, limit: usize) -> Vec<WebSearchHit> {
    let mut hits = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let re_result = Regex::new(
        r#"class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>"#,
    )
    .ok();
    if let Some(re) = re_result {
        for cap in re.captures_iter(html) {
            let raw_url = cap.get(1).map(|m| m.as_str()).unwrap_or("");
            let url = decode_ddg_redirect(raw_url);
            let title = strip_html(cap.get(2).map(|m| m.as_str()).unwrap_or(""));
            if !is_usable_hit(&url, &title) {
                continue;
            }
            let key = url.trim().trim_end_matches('/').to_lowercase();
            if !seen.insert(key) {
                continue;
            }
            hits.push(WebSearchHit {
                title,
                url,
                snippet: String::new(),
            });
            if hits.len() >= limit {
                break;
            }
        }
    }
    if hits.is_empty() {
        // lite.duckduckgo.com uses result-link
        if let Ok(re) = Regex::new(r#"class=['"]result-link['"][^>]*href=['"]([^'"]+)['"][^>]*>(.*?)</a>"#) {
            for cap in re.captures_iter(html) {
                let raw = cap.get(1).map(|m| m.as_str()).unwrap_or("");
                let url = decode_ddg_redirect(raw);
                let title = strip_html(cap.get(2).map(|m| m.as_str()).unwrap_or(""));
                if !is_usable_hit(&url, &title) {
                    continue;
                }
                let key = url.trim().trim_end_matches('/').to_lowercase();
                if !seen.insert(key) {
                    continue;
                }
                hits.push(WebSearchHit {
                    title,
                    url,
                    snippet: String::new(),
                });
                if hits.len() >= limit {
                    break;
                }
            }
        }
    }
    if hits.is_empty() {
        if let Ok(re) = Regex::new(r#"uddg=([^&"]+)"#) {
            for cap in re.captures_iter(html).take(limit * 3) {
                let enc = cap.get(1).map(|m| m.as_str()).unwrap_or("");
                let url = urlencoding_decode(enc);
                if !is_usable_hit(&url, &url) {
                    continue;
                }
                let key = url.trim().trim_end_matches('/').to_lowercase();
                if !seen.insert(key) {
                    continue;
                }
                hits.push(WebSearchHit {
                    title: url.clone(),
                    url,
                    snippet: String::new(),
                });
                if hits.len() >= limit {
                    break;
                }
            }
        }
    }
    hits
}

fn decode_ddg_redirect(href: &str) -> String {
    if let Some(idx) = href.find("uddg=") {
        let rest = &href[idx + 5..];
        let enc = rest.split('&').next().unwrap_or(rest);
        return urlencoding_decode(enc);
    }
    if href.starts_with("http") {
        return href.to_string();
    }
    String::new()
}

fn urlencoding_decode(s: &str) -> String {
    let mut out = Vec::new();
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let hex = &s[i + 1..i + 3];
                if let Ok(v) = u8::from_str_radix(hex, 16) {
                    out.push(v);
                }
                i += 3;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).to_string()
}

fn strip_html(html: &str) -> String {
    let re = Regex::new(r"<[^>]+>").ok();
    let no_tags = if let Some(re) = re {
        re.replace_all(html, " ").to_string()
    } else {
        html.to_string()
    };
    let decoded = no_tags
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#x27;", "'")
        .replace("&nbsp;", " ");
    decoded.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_simple_html() {
        assert_eq!(strip_html("<p>Hola <b>mundo</b></p>"), "Hola mundo");
    }

    #[test]
    fn opportunity_detection_and_portal_seeds() {
        let q = "Busca en la web ofertas QA Lead remoto en España";
        assert!(looks_like_opportunity_search(q));
        let seeds = opportunity_portal_seeds(q);
        assert!(seeds.len() >= 5);
        assert!(seeds.iter().any(|h| h.url.contains("linkedin.com/jobs")));
        assert!(seeds.iter().any(|h| h.url.contains("infojobs.net")));
        assert!(seeds.iter().any(|h| h.url.contains("indeed.com")));
    }

    #[test]
    fn gaming_query_seeds_include_hitmarker() {
        let q = "Busca ofertas de las mejores empresas de videojuegos remoto para senior QA tester";
        assert!(looks_like_opportunity_search(q));
        assert!(looks_like_gaming_job_search(q));
        let kw = opportunity_keywords(q);
        assert!(
            kw.contains("Senior QA Tester") && kw.contains("games"),
            "expected compact keywords, got {kw}"
        );
        let seeds = opportunity_portal_seeds(q);
        assert!(
            seeds.iter().any(|h| h.url.contains("hitmarker.net")),
            "missing Hitmarker seed"
        );
        assert!(seeds.iter().any(|h| h.url.contains("linkedin.com/jobs")));
        assert!(seeds.iter().any(|h| h.url.contains("workwithindies.com")));
        assert!(
            seeds.iter().any(|h| h.url.contains("Senior%20QA%20Tester")
                || h.url.contains("Senior+QA+Tester")),
            "portal URL should encode compact keywords: {:?}",
            seeds.first().map(|h| &h.url)
        );
    }

    #[test]
    fn anti_bot_job_boards_detected() {
        assert!(is_anti_bot_job_board("https://www.linkedin.com/jobs/search/?keywords=QA"));
        assert!(is_anti_bot_job_board("https://hitmarker.net/jobs?keyword=QA"));
        assert!(is_anti_bot_job_board("https://es.indeed.com/jobs?q=QA"));
        assert!(!is_anti_bot_job_board("https://example.com/blog/qa-tips"));
    }

    #[test]
    fn bing_redirect_decodes_base64_u_param() {
        // "https://example.com/job" base64
        let b64 = "aHR0cHM6Ly9leGFtcGxlLmNvbS9qb2I=";
        let href = format!("https://www.bing.com/ck/a?!&u=a1{b64}&ntb=1");
        assert_eq!(decode_bing_redirect(&href), "https://example.com/job");
    }

    #[test]
    fn junk_ads_filtered() {
        assert!(is_junk_result_url("https://duckduckgo.com/y.js?ad=1"));
        assert!(!is_junk_result_url("https://www.crossover.com/jobs/quality-assurance/es"));
    }

    #[tokio::test]
    async fn opportunity_search_always_includes_portal_seeds() {
        // Seeds are injected before SERP; even with network failure we must get portals.
        let hits = web_search_with_depth(
            "Busca en la web ofertas QA Lead remoto en España",
            12,
            "pro",
            None,
        )
        .await
        .expect("search");
        assert!(
            hits.iter().any(|h| h.url.contains("linkedin.com/jobs")),
            "missing LinkedIn seed"
        );
        assert!(
            hits.iter().any(|h| h.url.contains("infojobs.net")),
            "missing InfoJobs seed"
        );
        assert!(
            hits.iter().any(|h| h.url.contains("indeed.com")),
            "missing Indeed seed"
        );
        assert!(hits.len() >= 5, "expected >=5 hits (seeds), got {}", hits.len());
    }

    #[tokio::test]
    async fn draft_agent_has_expected_status() {
        let spec = draft_agent_from_prompt("Test", "Buscar ofertas QA");
        assert_eq!(spec.status, AgentStatus::Draft);
        assert!(!spec.search.queries.is_empty());
    }
}
