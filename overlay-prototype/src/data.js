export const rhythmData = [
  { time: "9:00", value: 42 },
  { time: "9:10", value: 53 },
  { time: "9:20", value: 48 },
  { time: "9:30", value: 66 },
  { time: "9:40", value: 56 },
  { time: "9:50", value: 76 },
  { time: "10:00", value: 68 },
  { time: "10:10", value: 82 },
];

export const sessions = [
  {
    time: "9:46 – 10:10 AM",
    duration: "24 min",
    title: "Researching authentication documentation",
    category: "Research",
    apps: "Chrome · VS Code",
    state: "Focused",
  },
  {
    time: "9:08 – 9:44 AM",
    duration: "36 min",
    title: "Debugging the sign-in callback",
    category: "Debugging",
    apps: "VS Code · Terminal · Chrome",
    state: "High friction",
  },
  {
    time: "8:31 – 9:03 AM",
    duration: "32 min",
    title: "Planning the onboarding flow",
    category: "Writing",
    apps: "Notion · Figma",
    state: "Steady",
  },
];

export const workflowSteps = [
  { app: "Jira", label: "Open authentication ticket", duration: "1m" },
  { app: "VS Code", label: "Locate callback handler", duration: "4m" },
  { app: "Terminal", label: "Run authentication tests", duration: "2m", repeated: true },
  { app: "Browser", label: "Search the same callback error", duration: "5m", friction: true },
  { app: "VS Code", label: "Modify handler and retry", duration: "7m", repeated: true },
  { app: "Terminal", label: "Run authentication tests", duration: "2m", repeated: true },
];

export const insights = [
  {
    kind: "Context switching",
    title: "The browser → editor loop interrupted your focus",
    body: "You switched between Chrome and VS Code 7 times in 24 minutes while researching the same error.",
    evidence: "7 app switches · 3 repeated searches · 2 reopened files",
    priority: "High",
  },
  {
    kind: "Workflow improvement",
    title: "Keeping documentation beside your editor reduces retries",
    body: "Similar debugging sessions finished 18% faster when documentation stayed open next to VS Code.",
    evidence: "Compared with 6 similar sessions this week",
    priority: "Useful",
  },
  {
    kind: "Automation opportunity",
    title: "Open the relevant files when a Jira ticket begins",
    body: "The same ticket → project → source-file sequence appeared 8 times today.",
    evidence: "High confidence · about 9 minutes saved per day",
    priority: "High",
  },
];

export const trackingSources = [
  ["Application activity", true],
  ["Window switching", true],
  ["Browser tab activity", true],
  ["Keyboard timing", true],
  ["Clipboard events", false],
  ["Terminal activity", true],
  ["Screen content", false],
  ["AI analysis", true],
];
