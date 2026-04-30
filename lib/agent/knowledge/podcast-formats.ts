/**
 * Podcast formats — the craft library the Builder/Editor consults to make
 * good shape decisions for ANY podcast pitch.
 *
 * This is intentionally NOT a topic catalog. The point of the podcast
 * builder is that it should be able to support anything — a Bravo recap
 * show, sports gambling angles, a daily Anthropic/OpenAI ship-watch,
 * indie game launches, an NPR-style measured news brief — by combining
 * a STRUCTURAL format from this library with TOPIC + PERSPECTIVE +
 * SOURCES the user supplies.
 *
 * Each entry is a recipe for the SHAPE of a podcast: target length,
 * segment count, segment-shape templates, monitor-pattern hints,
 * voice/tone notes, and the elicitation playbook the builder runs
 * to extract the user's specific topic/lens/sources.
 *
 * Mirror of strategy-archetypes.ts:
 *   - id (SCREAMING_SNAKE_CASE)
 *   - name + tagline
 *   - description (when to use, who it's for)
 *   - structural fields (target seconds, segment count, segment templates)
 *   - sourcing playbook (how to fence the universe by user-supplied sources)
 *   - hostStyle hints
 *   - elicitation questions
 *
 * Adding one: keep prompts under ~300 words. The builder expands them.
 */

export interface SegmentTemplate {
  /** Short label, e.g. "Top stories", "Deep dive". */
  name: string;
  /** Editorial brief — 2-4 sentences. The builder ADAPTS this to the user's
   *  pitch (substitutes topic/perspective/sources), not copies verbatim. */
  segmentPrompt: string;
  /** Suggested length in seconds. Sums (across templates) should land near
   *  recommendedEpisodeSeconds — host transitions add ~30-60s of slack. */
  targetSeconds: number;
  /** Hints for the builder's monitor proposal. NOT topic words — these are
   *  patterns ("daily news Sonar query", "user's preferred outlets as DOMAIN
   *  monitors"). The builder fills the actual topic in. */
  monitorHints: string[];
}

export interface PodcastFormat {
  /** SCREAMING_SNAKE_CASE unique ID */
  id: string;
  /** Short human label */
  name: string;
  /** One-sentence pitch */
  tagline: string;
  /** Long-form when/why-to-use */
  description: string;
  /** Recommended total episode length in seconds (rough). */
  recommendedEpisodeSeconds: number;
  /** Recommended number of segments per episode. */
  recommendedSegmentCount: number;
  /** Default cadence the format implies — informational only. */
  defaultCadence: "DAILY" | "WEEKLY" | "BIWEEKLY" | "ON_DEMAND";
  /** Segment templates the builder ADAPTS for this user's specific topic. */
  segmentTemplates: SegmentTemplate[];
  /** Voice/tone register hints the builder threads into hostStyle + segment
   *  prompts. The user's stated tone overrides; these are starting points. */
  hostStyleHints: string[];
  /** Sourcing playbook — how to translate the user's topic + source
   *  preferences into Monitor rows. Domain monitors fence to the user's
   *  trusted outlets; SEARCH monitors discover NEW material in scope. */
  sourcingPlaybook: string;
  /** The 2-4 questions the builder MUST ask via ask_question before
   *  proposing a config. These are the elicitation hooks that get the user
   *  from "make me a tech podcast" to a workable Podcast + Segments. */
  elicitationQuestions: Array<{
    question: string;
    options: Array<{ label: string; description?: string }>;
    /** True if this is a write-in / text-input style question that
     *  ask_question should present as a single prompt with no options.
     *  The current ask_question schema needs at least 2 options though,
     *  so the builder should phrase as multi-choice + an "Other" escape. */
    multiSelect?: boolean;
  }>;
  /** Common pitfalls this format runs into. */
  watchOutFor: string[];
}

export const PODCAST_FORMATS: PodcastFormat[] = [
  {
    id: "DAILY_NEWS_BRIEF",
    name: "Daily News Brief",
    tagline:
      "5-10 minute daily roundup with a clear point of view, not just a wire-service recap.",
    description: `The strongest format for daily news on a defined beat — politics, finance, tech, sports, a specific industry, a specific company. Listeners want fast catch-up + the host's take, not a 30-minute panel. Works for any subject the user wants daily updates on, with any perspective (NPR-measured, irreverent, gambling-angled, fan-perspective). The format gives the structure; the user's pitch gives the lens.`,
    recommendedEpisodeSeconds: 480,
    recommendedSegmentCount: 3,
    defaultCadence: "DAILY",
    segmentTemplates: [
      {
        name: "Top Stories",
        segmentPrompt: `Lead segment. Cover the 2-3 most important developments on the user's beat from the last ~24 hours, with the user's perspective threaded through. Each story gets a one-sentence what-happened, then 1-2 sentences of why-it-matters in this show's voice. Skip stories outside scope even if they're the day's biggest. Keep claims defensible — every fact citable.`,
        targetSeconds: 240,
        monitorHints: [
          "DOMAIN monitors on each of the user's named trusted outlets (one Monitor row per outlet)",
          "SEARCH monitors with topic + 24h time qualifier — e.g. 'NFL injury reports today', 'AI model releases today', 'Bravo cast announcements this week'",
          "If the user mentioned specific people / companies / shows, dedicate one SEARCH monitor per — e.g. 'OpenAI announcements today', 'Bachelor in Paradise spoilers this week'",
        ],
      },
      {
        name: "Deep Dive",
        segmentPrompt: `Mid-episode beat. Pick ONE story or angle from today and unpack it for 2-3 minutes — context, who's involved, what's actually new vs hype, what to watch next. The angle matches the show's perspective: a gambling show treats injury news as edge; an NPR-style show treats it as context for fans. Use one extracted article (read_artifact) so the unpack is grounded.`,
        targetSeconds: 180,
        monitorHints: [
          "Same monitors as Top Stories — Deep Dive picks from the routed pile",
          "If the show needs deeper sourcing, add 1-2 long-form DOMAIN monitors (e.g. The Athletic for sports, Stratechery for tech, Variety for entertainment)",
        ],
      },
      {
        name: "Closing Take",
        segmentPrompt: `Sign-off segment. ~60-90 seconds. Pull back to a higher-altitude observation, a one-line prediction, or a thread to follow tomorrow. Match the show's voice — wry for irreverent shows, measured for NPR-style, a gambling angle for sports-betting shows. Don't summarize the episode (the listener just heard it).`,
        targetSeconds: 60,
        monitorHints: ["No new monitors needed — pulls from the day's material"],
      },
    ],
    hostStyleHints: [
      "Match the user's stated tone literally — if they said 'irreverent', don't drift into NPR-formal",
      "Daily cadence = informal cadence — even measured shows are conversational, not essayistic",
      "Each segment opens with the lede, no 'today on the show…' meta-narration",
    ],
    sourcingPlaybook: `Daily-news shows live or die by source quality. Two paths:

1. **User named specific outlets** ("I want news from The Verge, TechCrunch, and The Information") → ONE DOMAIN monitor per outlet. Each becomes a Sonar query fenced to that domain. Quality scores 4-5 for premium outlets, 3 for mainstream, 2 for tabloid/aggregator (still useful for breadth).

2. **User named a topic but not outlets** ("I want a daily AI podcast", "Bravo news") → propose 3-5 high-signal DOMAIN monitors that cover the beat well. For Bravo: realityblurb.com, page-six, e-online. For AI: anthropic.com/news, openai.com/blog, theverge.com, theinformation.com. For sports gambling: actionnetwork.com, vegas insider, the-athletic. ASK via ask_question whether to add or swap any.

3. ALWAYS layer in 2-3 SEARCH monitors with the topic + a 24h/week qualifier so NEW material gets discovered (story breaks before it lands on a tracked outlet).

Hard rule: NEVER invent fictional outlets. Every domain proposed must be a real, reachable site.`,
    elicitationQuestions: [
      {
        question: "What's the show about — what beat or topic?",
        options: [
          { label: "Tech / AI products & companies", description: "OpenAI, Anthropic, ship-watch" },
          { label: "Politics / policy", description: "national or local" },
          { label: "Sports", description: "league, fantasy, gambling angles" },
          { label: "Markets & finance", description: "macro, single-stock, sector" },
          { label: "Entertainment / culture", description: "Bravo, music, awards, gaming" },
          { label: "Industry-specific", description: "user describes their niche" },
          { label: "Something else", description: "user describes in next turn" },
        ],
      },
      {
        question: "What's the lens or perspective?",
        options: [
          { label: "NPR-style measured", description: "neutral framing, even-handed" },
          { label: "Irreverent / dry-witty", description: "Knowles-Galloway energy" },
          { label: "Fan / enthusiast", description: "in-the-weeds, opinionated" },
          { label: "Analytical / contrarian", description: "the take you don't get elsewhere" },
          { label: "Action / edge-focused", description: "for traders, gamblers, operators" },
          { label: "Conversational / casual", description: "two-friends-talking energy" },
        ],
      },
      {
        question: "Which sources do you trust most? (multi-select)",
        multiSelect: true,
        options: [
          { label: "Tier-1 mainstream", description: "NYT, WSJ, Reuters, AP, Bloomberg" },
          { label: "Industry trade", description: "user names their niche outlets" },
          { label: "Independent / Substack-tier", description: "Stratechery, Matt Levine, Pivot" },
          { label: "Tabloid / aggregator", description: "Page Six, TMZ, Bleacher Report" },
          { label: "Primary sources", description: "company blogs, SEC, league press" },
          { label: "I want you to choose", description: "builder picks defaults, user can edit" },
        ],
      },
    ],
    watchOutFor: [
      "Daily shows die when sourcing is too narrow — always include 2-3 SEARCH monitors so NEW material is discoverable.",
      "Don't propose >5 segments in 8-10 minutes — pacing breaks. 3 segments is the sweet spot.",
      "Closing Take should NOT recap. If it does, cut it.",
      "Time qualifiers in SEARCH queries are mandatory — 'AI news' is useless, 'AI product launches today' actually returns the day's hits.",
    ],
  },
  {
    id: "WEEKLY_ROUNDUP",
    name: "Weekly Roundup",
    tagline:
      "20-30 minute weekly recap — wider lens, more synthesis, catches up listeners who skipped the daily noise.",
    description: `For weekly cadence on any beat. Different from a daily — listeners weren't tracking every twist, so segments need more setup, more synthesis, less assumed context. Strong for sports (week-in-review), entertainment (this-week-in-Bravo), industry tracking (AI ships of the week, Substack creator economy), markets (week-in-macro). Pace is more reflective than urgent.`,
    recommendedEpisodeSeconds: 1500,
    recommendedSegmentCount: 4,
    defaultCadence: "WEEKLY",
    segmentTemplates: [
      {
        name: "Week in Review",
        segmentPrompt: `Recap segment, 5-6 minutes. Walk through the week's 4-6 biggest stories on the beat. For each: what happened (one beat), why it matters in context (one beat), how it connects to the larger thread the show tracks. This is the "if you missed everything, here's what you missed" segment.`,
        targetSeconds: 360,
        monitorHints: [
          "DOMAIN monitors on the user's preferred outlets",
          "SEARCH monitors with week-qualifier — 'this week', 'last 7 days'",
          "Optional: a 'Top of the Week' aggregator monitor that summarizes the beat's headline ranks",
        ],
      },
      {
        name: "Deep Dive",
        segmentPrompt: `Long-form segment, 8-10 minutes. Pick ONE story or theme from the week and go deep — 3-5 sources, multiple angles, what's actually new vs noise, what listeners should expect next. The host has time here for a real argument or unpacking. Cite at least 2 read_artifact extractions.`,
        targetSeconds: 540,
        monitorHints: [
          "Long-form DOMAIN monitors — outlets that publish substantive pieces (NYT magazine, The Atlantic, The Verge longreads, Stratechery, Variety features)",
          "Search for primary documents — 'X official blog post', 'X SEC filing', 'X press release'",
        ],
      },
      {
        name: "What to Watch Next Week",
        segmentPrompt: `Forward-looking segment, 3-4 minutes. Tee up what's coming — scheduled launches, expected announcements, scheduled events, ongoing arcs. Each item gets a sentence on what it is and what to listen for. This is the segment that hooks return listeners.`,
        targetSeconds: 240,
        monitorHints: [
          "Calendar-style monitors — 'upcoming releases', 'scheduled events this week', 'expected catalysts'",
          "If the beat has a calendar source (sports schedules, earnings calendar, awards calendar), use it as a DOMAIN monitor",
        ],
      },
      {
        name: "Closing Thoughts",
        segmentPrompt: `Sign-off, 2-3 minutes. The host's higher-altitude take on the week — a pattern across stories, a contrarian view, a personal note that matches the show's voice. NOT a recap of the recap.`,
        targetSeconds: 150,
        monitorHints: ["No new monitors — works off the week's pile"],
      },
    ],
    hostStyleHints: [
      "Weekly = more reflective. Sentences can be longer, takes can be more developed.",
      "Listener probably didn't hear yesterday's news — re-establish context for each story",
      "Host can sustain a viewpoint across segments (vs daily where each segment is independent)",
    ],
    sourcingPlaybook: `Weekly shows can lean harder on long-form sources because there's room to read them. Mix:

- **Premium long-form** (Stratechery, The Athletic, NYT Magazine, Variety) — 3-4 DOMAIN monitors at quality 4-5
- **Mainstream daily** (NYT, WSJ, Reuters) — 2-3 DOMAIN monitors for breadth
- **Primary sources** (company blogs, SEC filings, league transactions) — 1-2 DOMAIN monitors for deep-dive material
- **Discovery SEARCH** — 2-3 with 'this week' / 'last 7 days' qualifiers, scoped to the beat

The Deep Dive segment specifically needs sources that go beyond the headlines. Always include at least one outlet known for analysis vs reporting.`,
    elicitationQuestions: [
      {
        question: "What's the beat?",
        options: [
          { label: "Sports", description: "league, sport, fantasy, gambling angle" },
          { label: "Entertainment / culture", description: "Bravo, awards, music, gaming" },
          { label: "Tech / industry", description: "AI, startups, specific company watch" },
          { label: "Politics / policy", description: "national, regional, issue-focused" },
          { label: "Markets / finance", description: "macro, sector, theme" },
          { label: "Other / niche", description: "user describes" },
        ],
      },
      {
        question: "How long should episodes be?",
        options: [
          { label: "~20 min", description: "tight roundup, 3 segments" },
          { label: "~30 min", description: "standard, 4 segments" },
          { label: "~45 min", description: "long-form, 5 segments with extended deep dive" },
        ],
      },
      {
        question: "How interpretive should the host be?",
        options: [
          { label: "Reporter-first", description: "facts up front, takes light" },
          { label: "Balanced", description: "facts + visible POV, no rants" },
          { label: "Opinionated", description: "the take is the point" },
        ],
      },
    ],
    watchOutFor: [
      "Don't try to cover EVERY weekly story — pick 4-6 max for Week in Review or pacing dies.",
      "Deep Dive only works if the user can name a real long-form outlet to source from. Without that, it falls flat.",
      "What to Watch needs a real calendar — if the beat doesn't have predictable upcoming events, drop this segment.",
    ],
  },
  {
    id: "INTERVIEW_SHOW",
    name: "Interview Show",
    tagline:
      "30-45 minute conversation format — host prepares, agent surfaces material, the show is the dialogue.",
    description: `Less common as a fully-AI-generated podcast, but useful when the user wants a "what would I ask X if I had them on" or "synthesize the public conversation about X" format. Each episode focuses on one subject (a person, a company, a topic). Segments are angles of attack rather than independent beats. Strong for thought-leader watch, single-company deep dives, retrospectives, profile shows.`,
    recommendedEpisodeSeconds: 1800,
    recommendedSegmentCount: 3,
    defaultCadence: "WEEKLY",
    segmentTemplates: [
      {
        name: "Setup",
        segmentPrompt: `Open the episode by introducing today's subject and why now — what's making them relevant this week, what's at stake, what the listener should care about. 2-3 minutes. Cite 2-3 sources establishing the moment. End with the question the rest of the show will explore.`,
        targetSeconds: 180,
        monitorHints: [
          "SEARCH monitors on the subject's name + recent qualifier",
          "DOMAIN monitors on the subject's primary outlets (their company blog, their personal site, where they publish)",
        ],
      },
      {
        name: "The Conversation",
        segmentPrompt: `Main segment, 20-25 minutes — synthesize public-record material into a coherent narrative arc. Treat this like writing what Lex Fridman or Ezra Klein would actually ask. Sources: the subject's own writing, recent interviews, the most insightful third-party coverage. Keep the narrative moving — don't get stuck on one story. Cite 5-8 sources.`,
        targetSeconds: 1380,
        monitorHints: [
          "DOMAIN monitors on long-form outlets that have profiled the subject",
          "Specific search queries for 'X interview transcript', 'X talk', 'X podcast appearance'",
          "Primary sources: subject's blog, papers, public statements",
        ],
      },
      {
        name: "What's Next",
        segmentPrompt: `Close the episode with what's coming for the subject — upcoming announcements, expected pivots, things to watch. 3-4 minutes. Forward-looking, lower-confidence than the main segment. End with a clean sign-off, no recap.`,
        targetSeconds: 240,
        monitorHints: [
          "Calendar-style searches: 'X upcoming announcement', 'X next product', 'X 2026 plans'",
        ],
      },
    ],
    hostStyleHints: [
      "Interview-show host is intellectually curious, not adversarial",
      "Voice should sound like a thoughtful interviewer reading careful notes — closer to Ezra Klein than to a hot-take show",
      "Long sentences allowed. The form supports it.",
    ],
    sourcingPlaybook: `Interview shows live on quality of synthesis. Sourcing must be:

- **Subject's own work** — their writing, their interviews, their public talks (DOMAIN: their blog, their company site)
- **Long-form profiles** — outlets that did real reporting on them (NYT, New Yorker, Wired, The Information, Substack publications)
- **Recent news** — SEARCH on subject + 30d qualifier for what's making them relevant now

Avoid: short news hits, gossip, secondary aggregators. The format demands depth.`,
    elicitationQuestions: [
      {
        question: "Who or what is each episode about?",
        options: [
          { label: "Specific people I'll name each week", description: "founder profiles, public figures" },
          { label: "Companies", description: "company-of-the-week deep dive" },
          { label: "Topics / ideas", description: "concept-of-the-week format" },
          { label: "Mixed", description: "I'll mix people, companies, topics" },
        ],
      },
      {
        question: "How are subjects chosen?",
        options: [
          { label: "I'll specify per episode", description: "user-driven each week" },
          { label: "Discover from a watchlist", description: "agent surfaces the most-active subject from a fixed pool" },
          { label: "Discover by current relevance", description: "agent picks who's making news in the beat" },
        ],
      },
    ],
    watchOutFor: [
      "Interview shows REQUIRE the subject to be public-record-rich. Don't propose this format for niche subjects without coverage.",
      "AI-generated 'interviews' don't actually have an interviewee — be explicit in the host style that this is synthesis, not a fake interview.",
      "30+ minutes of synthesis demands strong sourcing. If the user's source list is thin, downgrade to Daily News Brief or Weekly Roundup.",
    ],
  },
  {
    id: "ESSAY_AND_ANALYSIS",
    name: "Essay & Analysis",
    tagline:
      "10-15 minute single-essay format — one argument, well-sourced, ends with a thesis the listener takes away.",
    description: `Single-segment-feeling format (often technically 1-2 segments). Each episode is one essay on one question. Strong for thought-leadership, contrarian takes, technical explainers, reflective commentary. Less catalyst-driven than news formats — works on a slower cadence (weekly or biweekly). The host is the show.`,
    recommendedEpisodeSeconds: 720,
    recommendedSegmentCount: 2,
    defaultCadence: "WEEKLY",
    segmentTemplates: [
      {
        name: "The Question",
        segmentPrompt: `Open with the question or claim today's essay tackles. 1-2 minutes. State it clearly, ground it in one fresh news hook (something that happened this week / this month making the question relevant), and tee up the argument the rest of the segment will make.`,
        targetSeconds: 90,
        monitorHints: [
          "SEARCH monitors on the user's essay topics + recency qualifier",
          "1-2 DOMAIN monitors on outlets known for the topic's discourse",
        ],
      },
      {
        name: "The Argument",
        segmentPrompt: `Main segment, 9-12 minutes. Make the actual argument. Build it claim-by-claim with sources for each. Acknowledge the strongest counter-argument and address it. End with the thesis the listener should take away — one sentence they could repeat to a friend. Cite 4-6 sources.`,
        targetSeconds: 600,
        monitorHints: [
          "Long-form DOMAIN monitors — Substack publications, The Atlantic, NYT Opinion, The New Yorker, industry-specific essay outlets",
          "Primary sources for any factual claims (papers, filings, official statements)",
        ],
      },
    ],
    hostStyleHints: [
      "Essay format supports the most distinctive voice — encourage the user to lean into specific stylistic choices (dry, wry, formal, intimate)",
      "Long sentences welcome. Subordinate clauses welcome.",
      "End-of-segment thesis MUST be tight enough to quote",
    ],
    sourcingPlaybook: `Essay shows can use slow-twitch sources — Substacks, magazine longreads, books, papers. The format rewards depth over recency. Mix:

- **Long-form essay outlets** (Substack writers in the beat, The Atlantic, NYT Magazine, n+1, LRB)
- **Primary sources** (papers if technical, filings if business, statements if political)
- **One news-hook search** so each episode starts with a fresh peg

Avoid: fast-twitch news outlets that dominate other formats. The essay form needs material to think with, not just react to.`,
    elicitationQuestions: [
      {
        question: "What's the essay topic each week?",
        options: [
          { label: "I have a specific beat", description: "all essays orbit one subject" },
          { label: "I have a sensibility, not a topic", description: "essays span topics, voice ties them" },
          { label: "I'll specify per week", description: "user picks the subject each episode" },
        ],
      },
      {
        question: "What's the host's primary stance?",
        options: [
          { label: "Explainer", description: "make a complex thing clear" },
          { label: "Contrarian", description: "the take you don't get elsewhere" },
          { label: "Reflective", description: "what does this mean? what does this remind us of?" },
          { label: "Evaluative", description: "is this good? is this true? rate / rank / argue" },
        ],
      },
    ],
    watchOutFor: [
      "Essay format dies without a strong host voice. If the user just wants 'news', steer them to Daily Brief or Weekly Roundup.",
      "Don't propose >2 segments — the form is single-essay; segmenting it fragments the argument.",
      "Each episode MUST have a thesis. If the agent's transcript ends without a takeaway, the run failed.",
    ],
  },
  {
    id: "RECAP_AND_REACTION",
    name: "Recap & Reaction",
    tagline:
      "15-20 minute fan-perspective format — recap the event/thing, react to it, predict what's next.",
    description: `Built for any subject with a recurring "thing happened, fans want to talk about it" loop. Sports games, reality-TV episodes, awards shows, gaming releases, product launches, finale-day movie premieres. The format assumes listeners care about the thing — they don't need backstory, they need a smart fan's voice.`,
    recommendedEpisodeSeconds: 1080,
    recommendedSegmentCount: 3,
    defaultCadence: "WEEKLY",
    segmentTemplates: [
      {
        name: "What Happened",
        segmentPrompt: `Recap the thing. 5-6 minutes. Don't pretend it's news for a stranger — listeners watched / followed it. The job is to capture the moments worth talking about: best plays, biggest twists, callable shots, controversies. Match the show's voice (deadpan, hyped, snarky, analytical).`,
        targetSeconds: 360,
        monitorHints: [
          "DOMAIN monitors on outlets that recap the thing (sports recap sites, reality-TV recap blogs, industry trade press for product launches)",
          "SEARCH monitors with the event name + 24-48h qualifier",
          "Social monitor: SEARCH for 'X reactions' or 'X social media' to capture the discourse",
        ],
      },
      {
        name: "Reactions & Takes",
        segmentPrompt: `Middle segment, 4-5 minutes. Surface the smartest takes from the broader conversation — what other commentators / fans are saying. Quote 2-3 specific reactions, agree or disagree with each, and develop the show's own take. This is where the host's voice carries.`,
        targetSeconds: 270,
        monitorHints: [
          "Aggregator-style DOMAIN monitors — Reddit communities (via Sonar), Twitter discussion threads, recap sites' comment sections",
          "SEARCH for '[event] reactions' or 'best takes on [event]'",
        ],
      },
      {
        name: "What's Next",
        segmentPrompt: `Close, 3-4 minutes. What's coming next in the arc — next week's episode, next game, next launch. Set up what to watch, what to predict, what stakes are on the line. End with a one-line prediction the show stakes its credibility on.`,
        targetSeconds: 240,
        monitorHints: [
          "Calendar / schedule searches",
          "If the subject has a season arc (TV, sports, product roadmap), one DOMAIN monitor on the season's official source",
        ],
      },
    ],
    hostStyleHints: [
      "Recap-and-reaction is fan-perspective — first-person plural ('we', 'us') is natural",
      "Voice can be more emotional than other formats — frustration, excitement, snark all valid",
      "Don't explain basics. The listener already knows who the contestants are.",
    ],
    sourcingPlaybook: `Recap shows need fast-twitch sources because the subject is recent. Mix:

- **Recap-native outlets** (Reality Blurb for Bravo, Bleacher Report for sports, IGN/Polygon for gaming, Variety/Deadline for entertainment)
- **Social discourse** (Reddit, Twitter — surface the smartest fan takes)
- **Official sources** (the league / network / studio's own sites for next-up info)
- **One discovery SEARCH** with the event name + recent qualifier for breaking-after takes

Sourcing fails when it's all official-press-release; the format wants fan-perspective material too.`,
    elicitationQuestions: [
      {
        question: "What's being recapped?",
        options: [
          { label: "Sports", description: "league, team, fantasy, betting angle" },
          { label: "Reality TV", description: "Bravo, Bachelor, Survivor, drag races" },
          { label: "Awards / events", description: "Oscars, Grammys, draft, conferences" },
          { label: "Scripted TV / movies", description: "weekly episode reactions" },
          { label: "Product / game launches", description: "post-launch first impressions" },
          { label: "Other recurring events", description: "user describes the cadence" },
        ],
      },
      {
        question: "How invested is the listener?",
        options: [
          { label: "Hardcore fan", description: "no exposition needed, lean into details" },
          { label: "Casual follower", description: "some context, but assume basic familiarity" },
          { label: "Curious bystander", description: "more setup, less inside-baseball" },
        ],
      },
      {
        question: "What angle / take?",
        options: [
          { label: "Pure fan voice", description: "we love this, we hate this, we're invested" },
          { label: "Snarky / contrarian", description: "the takes that get hate-comments" },
          { label: "Analytical", description: "tactical / strategic / structural breakdown" },
          { label: "Cultural / meta", description: "what does this mean, what's the moment" },
          { label: "Wagering angle", description: "for sports — odds, props, futures" },
        ],
      },
    ],
    watchOutFor: [
      "Don't propose this format for subjects without recurring events — there has to be a 'thing' to recap.",
      "Casual-listener shows fail in this format — recap-and-react assumes investment. If the user wants newcomer-friendly, downgrade to Weekly Roundup.",
      "Reaction segment dies without good fan-discourse sources. Always include at least one social/community Sonar monitor.",
    ],
  },
  {
    id: "DAILY_TRACKER",
    name: "Daily Tracker / Ship Watch",
    tagline:
      "5-8 minute daily format watching a small set of subjects ship things — companies, people, products.",
    description: `Hyper-focused daily format. The user names a small list of subjects (companies, products, people, teams, shows) and the show tracks every move they make. Strong for company-watch shows ('AI labs ship watch'), single-company shadow shows ('Anthropic daily'), creator-economy tracking ('top 10 Substack writers this week'), front-office sports ('NFL transactions tracker'). The discipline is exclusion — only this list, only fresh moves.`,
    recommendedEpisodeSeconds: 420,
    recommendedSegmentCount: 2,
    defaultCadence: "DAILY",
    segmentTemplates: [
      {
        name: "Today's Moves",
        segmentPrompt: `Lead segment, 4-5 minutes. List the day's actual moves from the tracked subjects — product launches, announcements, hires, signings, releases, statements. One subject per beat: who, what, when, the implication in one sentence in this show's voice. Skip subjects with no moves today rather than padding. Cite primary sources where possible.`,
        targetSeconds: 270,
        monitorHints: [
          "ONE DOMAIN monitor per subject's primary site (e.g. anthropic.com/news, openai.com/blog, [team]-official, [creator]-substack)",
          "ONE SEARCH monitor per subject for breaking news that wouldn't land on their official site (regulatory, leaks, third-party coverage)",
        ],
      },
      {
        name: "Pattern of the Day",
        segmentPrompt: `Closing segment, 2-3 minutes. Pull back from the individual moves to a pattern — what do today's moves tell us about the broader shape of the watched space? Optional one-line prediction. NOT a recap.`,
        targetSeconds: 150,
        monitorHints: ["Works off the day's pile — no new monitors needed"],
      },
    ],
    hostStyleHints: [
      "Tracker format is dense — voice should be efficient, declarative, slightly clinical",
      "Don't editorialize on every move. Let the list breathe.",
      "Pattern-of-the-Day is where voice comes through — earn it",
    ],
    sourcingPlaybook: `Tracker formats live on the user's named subject list. Architecture:

- For EACH subject named: 1 DOMAIN monitor on their primary site (their blog, their company news, their team page) + 1 SEARCH monitor on their name + recent qualifier (catches third-party coverage)
- Optional: 1-2 broad SEARCH monitors as safety nets ('AI lab announcements today', 'NFL transactions today') so the show doesn't miss something the per-subject monitors miss

If the user can't name 3-10 specific subjects, this is the wrong format. Push toward Daily News Brief instead.`,
    elicitationQuestions: [
      {
        question: "Name the subjects to track (people / companies / products):",
        options: [
          { label: "I have a clear list", description: "user dictates 3-10 subjects" },
          { label: "Help me build one", description: "agent proposes from common picks in the beat" },
        ],
      },
      {
        question: "How do you want them framed?",
        options: [
          { label: "Neutral / wire-style", description: "facts, brief implication" },
          { label: "Insider / industry POV", description: "what this means inside the space" },
          { label: "Critical", description: "skeptical of marketing, surface the real story" },
          { label: "Enthusiast", description: "celebratory, fan-perspective, hype-aware" },
        ],
      },
    ],
    watchOutFor: [
      "Tracker format requires SUBJECTS, not topics. If the user can only describe a topic ('AI in healthcare'), this format will starve. Push to Daily News Brief.",
      "Without per-subject DOMAIN monitors, the show silently shifts into general news mode. Always seed at least one per subject named.",
      "Sub-3 subjects = there's not enough material for daily — propose Weekly Roundup.",
    ],
  },
  {
    id: "EXPLAINER_DEEP_DIVE",
    name: "Explainer / Deep Dive",
    tagline:
      "15-20 minute biweekly format — pick one thing, explain it from the ground up, leave the listener smarter.",
    description: `Single-topic biweekly format. Each episode picks one thing — a technology, a market mechanism, a regulatory regime, a cultural phenomenon, a sport's strategy — and explains it. Different from Essay & Analysis: explainers don't argue a thesis, they teach. Strong for technical shows, finance fundamentals, sport-mechanics shows, history of X.`,
    recommendedEpisodeSeconds: 960,
    recommendedSegmentCount: 3,
    defaultCadence: "BIWEEKLY",
    segmentTemplates: [
      {
        name: "Why This Matters Now",
        segmentPrompt: `Open by hooking today's topic to a current event or trend. 2-3 minutes. The listener needs a reason this isn't a textbook — what made you pick THIS topic THIS week. Cite 1-2 fresh sources establishing relevance.`,
        targetSeconds: 180,
        monitorHints: [
          "SEARCH monitors with the topic + recent qualifier for the news hook",
          "1 DOMAIN monitor on the discipline's house outlet (CNBC for finance, MIT Tech Review for science, the league's site for sports)",
        ],
      },
      {
        name: "The Mechanics",
        segmentPrompt: `Main segment, 9-12 minutes. Explain the thing from the ground up. Assume the listener is smart but unfamiliar. Build the understanding step-by-step — definitions, then the simple version, then nuances, then edge cases. Use concrete examples. Cite 4-6 sources, including at least one primary / authoritative.`,
        targetSeconds: 600,
        monitorHints: [
          "Authoritative DOMAIN monitors — academic / official / textbook-tier sources",
          "Long-form explainers (Investopedia, Khan Academy, official documentation, federation rule books)",
          "SEARCH for 'X explained', 'how X works', 'X for beginners'",
        ],
      },
      {
        name: "What to Watch / How to Use This",
        segmentPrompt: `Close by translating the explanation into practical takeaway, 3-4 minutes. Either: what to watch in the news now that you understand this, or how to use this knowledge in some practical decision. End with a memorable summary line.`,
        targetSeconds: 180,
        monitorHints: ["No new monitors — synthesizes from the episode's pile"],
      },
    ],
    hostStyleHints: [
      "Explainer voice is patient and literal. Avoid jargon unless you're defining it that beat.",
      "Concrete examples beat abstract explanations every time. Encourage the host to find them.",
      "Sound like a professor who likes their subject, not a textbook narrator",
    ],
    sourcingPlaybook: `Explainers live on authoritative sources, NOT news. Mix:

- **Authoritative / academic** (papers, textbooks, official rule books, regulator publications) — 2-3 DOMAIN monitors
- **High-quality explainer outlets** (Investopedia for finance, Khan Academy / 3Blue1Brown for math, official league sites for sports rules) — 1-2 DOMAIN monitors
- **Fresh news hook** — 1-2 SEARCH monitors with the topic + recent qualifier so each episode has a current peg

Avoid: hot-take outlets, social discourse. The format wants depth, not opinion.`,
    elicitationQuestions: [
      {
        question: "What domain are explainers in?",
        options: [
          { label: "Finance / markets", description: "mechanics of the financial system" },
          { label: "Tech / science", description: "how a technology actually works" },
          { label: "Sports", description: "strategy, rules, tactics" },
          { label: "Policy / regulation", description: "how a system is governed" },
          { label: "History", description: "how something came to be" },
          { label: "Industry-specific", description: "user's beat, mechanics-focused" },
        ],
      },
      {
        question: "Who's the listener?",
        options: [
          { label: "Smart generalist", description: "no domain expertise, but engaged" },
          { label: "Practitioner-curious", description: "works near the field, wants to go deeper" },
          { label: "Expert who wants polish", description: "user explains for fellow experts" },
        ],
      },
    ],
    watchOutFor: [
      "Explainer is the wrong format if the user wants reactions / hot takes — the form requires patience.",
      "Without authoritative sources, explainers become hand-wavy. Always seed at least one academic-tier DOMAIN monitor.",
      "Biweekly cadence is intentional — daily explainers run out of material fast. Push back if the user asks for daily.",
    ],
  },
];

/** Lookup by ID. */
export function getPodcastFormat(id: string): PodcastFormat | null {
  return PODCAST_FORMATS.find((f) => f.id === id) ?? null;
}

/** Short list of IDs + taglines for prompt inclusion / index views. */
export function podcastFormatIndex(): Array<{
  id: string;
  name: string;
  tagline: string;
  recommendedEpisodeSeconds: number;
  defaultCadence: PodcastFormat["defaultCadence"];
}> {
  return PODCAST_FORMATS.map((f) => ({
    id: f.id,
    name: f.name,
    tagline: f.tagline,
    recommendedEpisodeSeconds: f.recommendedEpisodeSeconds,
    defaultCadence: f.defaultCadence,
  }));
}
