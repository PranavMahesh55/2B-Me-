"use client";

import {
  Activity,
  ArrowUpRight,
  Bell,
  Brain,
  CalendarDays,
  ChevronDown,
  Compass,
  Flame,
  Gauge,
  HeartPulse,
  LayoutDashboard,
  MessageCircleMore,
  MoonStar,
  Route,
  Settings,
  Sparkles,
  Target,
  TrendingUp,
  UserRound,
  Sunrise,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";

const navItems = [
  { label: "Overview", icon: LayoutDashboard, active: true },
  { label: "Patterns", icon: Activity },
  { label: "Goals", icon: Target },
  { label: "Explore", icon: Compass },
];

const metrics = [
  { label: "Momentum", value: "78", suffix: "/100", icon: Gauge, tone: "lime", change: "+6 this week" },
  { label: "Consistency", value: "82", suffix: "%", icon: TrendingUp, tone: "teal", change: "6 of 7 days" },
  { label: "Focus blocks", value: "14", suffix: "", icon: Target, tone: "orange", change: "+3 vs. last week" },
  { label: "Active streak", value: "12", suffix: " days", icon: Flame, tone: "blue", change: "Personal best: 18" },
];

const toneClasses: Record<string, string> = {
  lime: "bg-[#e4f8bc] text-[#43601e]",
  teal: "bg-[#d4f2ed] text-[#216c62]",
  orange: "bg-[#ffead7] text-[#a75c28]",
  blue: "bg-[#e1e7ff] text-[#4a5fb3]",
};

const patterns = [
  {
    icon: Sunrise,
    title: "Your mornings are becoming an anchor",
    detail: "On days you start before 8:30, momentum averages 18% higher.",
    accent: "bg-[#e4f8bc] text-[#48651e]",
  },
  {
    icon: Brain,
    title: "Focus peaks between 9:30 and 11:00",
    detail: "This window accounts for 43% of your deep-work time this week.",
    accent: "bg-[#d4f2ed] text-[#216c62]",
  },
  {
    icon: MoonStar,
    title: "Late sessions may be costing recovery",
    detail: "Recovery is 11 points lower after work continues past 9:00 PM.",
    accent: "bg-[#e1e7ff] text-[#4a5fb3]",
  },
];

const signalMix = [
  { label: "Behavior", value: 86, color: "[&_[data-slot=progress-indicator]]:bg-[#91bd42]" },
  { label: "Cognition", value: 72, color: "[&_[data-slot=progress-indicator]]:bg-[#55ad9f]" },
  { label: "Wellbeing", value: 64, color: "[&_[data-slot=progress-indicator]]:bg-[#ed9a59]" },
  { label: "Context", value: 38, color: "[&_[data-slot=progress-indicator]]:bg-[#768be1]" },
];

function Brand() {
  return (
    <div className="flex items-center gap-3 px-2 py-2">
      <div className="grid size-10 place-items-center rounded-[14px] bg-[#c7f36b] text-[#173127] shadow-[0_8px_30px_rgba(199,243,107,0.18)]">
        <span className="text-[17px] font-extrabold tracking-[-0.08em]">2B</span>
      </div>
      <div className="leading-none group-data-[collapsible=icon]:hidden">
        <div className="text-[23px] font-semibold tracking-[-0.06em] text-white">
          2B<sup className="ml-0.5 align-super text-[10px] font-semibold tracking-normal text-[#c7f36b]">me</sup>
        </div>
        <p className="mt-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-white/45">Behavioral OS</p>
      </div>
    </div>
  );
}

function AppSidebar() {
  return (
    <Sidebar collapsible="icon" className="border-none bg-[#102d2c]">
      <SidebarHeader className="px-3 py-4">
        <Brand />
      </SidebarHeader>
      <SidebarContent className="px-2 py-3">
        <SidebarGroup>
          <SidebarGroupLabel className="px-3 text-[11px] uppercase tracking-[0.14em] text-white/40">Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-2">
              {navItems.map((item) => (
                <SidebarMenuItem key={item.label}>
                  <SidebarMenuButton
                    isActive={item.active}
                    tooltip={item.label}
                    className="h-11 rounded-xl px-3 text-white/62 hover:bg-white/8 hover:text-white data-[active=true]:bg-[#c7f36b] data-[active=true]:font-semibold data-[active=true]:text-[#183127]"
                  >
                    <item.icon />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-3">
        <div className="mb-2 rounded-2xl border border-white/8 bg-white/5 p-4 group-data-[collapsible=icon]:hidden">
          <Sparkles className="mb-3 size-5 text-[#c7f36b]" />
          <p className="text-sm font-semibold text-white">Your signal is getting clearer.</p>
          <p className="mt-1 text-xs leading-relaxed text-white/48">4 new patterns are ready to review.</p>
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Settings" className="h-10 rounded-xl px-3 text-white/55 hover:bg-white/8 hover:text-white">
              <Settings />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="mt-2 flex items-center gap-3 border-t border-white/8 px-2 pt-4 group-data-[collapsible=icon]:px-0">
          <div className="grid size-9 shrink-0 place-items-center rounded-full bg-[#e4a879] text-sm font-bold text-[#412817]">PM</div>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-sm font-semibold text-white">Pranav Mehta</p>
            <p className="truncate text-xs text-white/42">Personal workspace</p>
          </div>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function MiniChart() {
  return (
    <div className="relative mt-8 h-44 w-full overflow-hidden" aria-label="Behavioral momentum trend over seven days">
      <div className="absolute inset-x-0 top-[25%] border-t border-dashed border-white/12" />
      <div className="absolute inset-x-0 top-[55%] border-t border-dashed border-white/12" />
      <div className="absolute inset-x-0 top-[85%] border-t border-dashed border-white/12" />
      <svg viewBox="0 0 720 176" role="img" className="absolute inset-0 size-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="momentumFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#c7f36b" stopOpacity="0.35" />
            <stop offset="1" stopColor="#c7f36b" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d="M0 148 C62 140, 73 112, 120 120 S190 155, 240 108 S316 83, 360 99 S435 137, 480 81 S562 55, 600 64 S665 37, 720 30 L720 176 L0 176 Z" fill="url(#momentumFill)" />
        <path d="M0 148 C62 140, 73 112, 120 120 S190 155, 240 108 S316 83, 360 99 S435 137, 480 81 S562 55, 600 64 S665 37, 720 30" fill="none" stroke="#c7f36b" strokeWidth="4" strokeLinecap="round" />
        <circle cx="720" cy="30" r="6" fill="#102d2c" stroke="#c7f36b" strokeWidth="4" />
      </svg>
      <div className="absolute inset-x-0 bottom-0 flex justify-between text-[11px] font-medium text-white/38">
        {["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map((day) => <span key={day}>{day}</span>)}
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="min-w-0 bg-[#f3f6f5]">
        <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between border-b border-[#dfe8e5] bg-[#f3f6f5]/92 px-4 backdrop-blur-xl sm:px-7 lg:px-10">
          <div className="flex items-center gap-3">
            <SidebarTrigger className="size-9 rounded-xl border border-[#d8e4e1] bg-white text-[#244441] shadow-sm md:hidden" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#71817f]">Saturday, September 19</p>
              <h1 className="mt-1 text-xl font-semibold tracking-[-0.035em] text-[#142d2b] sm:text-2xl">Good morning, Pranav.</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" className="hidden h-10 rounded-xl border-[#d8e4e1] bg-white px-3 text-[#284744] shadow-sm sm:flex">
              <CalendarDays />
              Last 7 days
              <ChevronDown className="size-3.5 opacity-55" />
            </Button>
            <Button variant="outline" size="icon" aria-label="Messages" className="size-10 rounded-xl border-[#d8e4e1] bg-white text-[#284744] shadow-sm">
              <MessageCircleMore />
            </Button>
            <Button variant="outline" size="icon" aria-label="Notifications" className="relative size-10 rounded-xl border-[#d8e4e1] bg-white text-[#284744] shadow-sm">
              <Bell />
              <span className="absolute right-2 top-2 size-1.5 rounded-full bg-[#ea7e5d] ring-2 ring-white" />
            </Button>
          </div>
        </header>

        <div className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-7 lg:px-10 lg:py-8">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-[#6e7d7b]">Your week at a glance</p>
              <h2 className="mt-1 text-[28px] font-semibold tracking-[-0.045em] text-[#142d2b]">Behavioral overview</h2>
            </div>
            <div className="rounded-full border border-[#dce6e3] bg-white px-3 py-1.5 text-xs font-semibold text-[#647572] shadow-sm">Illustrative data</div>
          </div>

          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Key metrics">
            {metrics.map((metric) => (
              <article key={metric.label} className="rounded-[22px] border border-[#dfe8e5] bg-white p-5 shadow-[0_12px_35px_rgba(23,54,51,0.045)]">
                <div className="flex items-center justify-between">
                  <div className={"grid size-10 place-items-center rounded-[13px] " + toneClasses[metric.tone]}>
                    <metric.icon className="size-5" />
                  </div>
                  <span className="text-xs font-semibold text-[#6c7e7a]">{metric.change}</span>
                </div>
                <p className="mt-5 text-sm font-medium text-[#6a7b78]">{metric.label}</p>
                <p className="mt-1 text-[34px] font-semibold tracking-[-0.055em] text-[#153432]">
                  {metric.value}<span className="ml-1 text-[15px] font-medium tracking-normal text-[#71817e]">{metric.suffix}</span>
                </p>
              </article>
            ))}
          </section>

          <section className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(310px,0.75fr)]">
            <article className="min-w-0 overflow-hidden rounded-[26px] bg-[#143d3b] p-6 text-white shadow-[0_24px_60px_rgba(20,61,59,0.16)] sm:p-7">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#c7f36b]">Weekly momentum</p>
                  <div className="mt-3 flex items-end gap-3">
                    <span className="text-[48px] font-semibold leading-none tracking-[-0.065em]">78</span>
                    <span className="mb-1.5 rounded-full bg-white/8 px-2.5 py-1 text-xs font-semibold text-[#d9f7a2]">↑ 8%</span>
                  </div>
                </div>
                <div className="max-w-[240px] text-right text-sm leading-relaxed text-white/56">Your strongest lift came from a more consistent morning rhythm.</div>
              </div>
              <MiniChart />
            </article>

            <article className="relative overflow-hidden rounded-[26px] border border-[#dfe8e5] bg-white p-6 shadow-[0_12px_35px_rgba(23,54,51,0.045)] sm:p-7">
              <div className="absolute -right-12 -top-14 size-40 rounded-full bg-[#e7f5c7] blur-2xl" />
              <div className="relative">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#778683]">Today’s pulse</p>
                  <Activity className="size-5 text-[#4a8f84]" />
                </div>
                <div className="mt-7 grid place-items-center">
                  <div className="relative grid size-40 place-items-center rounded-full bg-[conic-gradient(#c7f36b_0deg,#c7f36b_281deg,#e7eeec_281deg,#e7eeec_360deg)] p-[13px]">
                    <div className="grid size-full place-items-center rounded-full bg-white text-center shadow-inner">
                      <div>
                        <p className="text-[40px] font-semibold leading-none tracking-[-0.06em] text-[#173936]">78</p>
                        <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-[#71817f]">Steady</p>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="mt-6 flex items-center justify-between rounded-2xl bg-[#f2f6f4] px-4 py-3">
                  <div className="flex items-center gap-2">
                    <UserRound className="size-4 text-[#53877f]" />
                    <span className="text-sm font-medium text-[#365451]">Check-ins complete</span>
                  </div>
                  <span className="text-sm font-bold text-[#173936]">3/4</span>
                </div>
              </div>
            </article>
          </section>

          <section className="mt-5 grid gap-5 pb-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]" aria-label="Behavioral insights">
            <article className="rounded-[26px] border border-[#dfe8e5] bg-white p-6 shadow-[0_12px_35px_rgba(23,54,51,0.045)] sm:p-7">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#778683]">Patterns shaping you</p>
                  <h3 className="mt-2 text-[22px] font-semibold tracking-[-0.035em] text-[#173735]">Small signals, useful direction</h3>
                </div>
                <Button variant="ghost" size="icon" aria-label="Open all patterns" className="size-9 rounded-xl text-[#4d6c68] hover:bg-[#edf3f1]">
                  <ArrowUpRight />
                </Button>
              </div>
              <div className="mt-6 divide-y divide-[#e7eeec]">
                {patterns.map((pattern) => (
                  <div key={pattern.title} className="flex gap-4 py-5 first:pt-0 last:pb-0">
                    <div className={"grid size-11 shrink-0 place-items-center rounded-[14px] " + pattern.accent}>
                      <pattern.icon className="size-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold text-[#1a3937]">{pattern.title}</p>
                      <p className="mt-1 text-sm leading-relaxed text-[#6a7b78]">{pattern.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </article>

            <div className="grid gap-5">
              <article className="rounded-[26px] border border-[#dfe8e5] bg-white p-6 shadow-[0_12px_35px_rgba(23,54,51,0.045)] sm:p-7">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#778683]">Signal mix</p>
                    <h3 className="mt-2 text-xl font-semibold tracking-[-0.035em] text-[#173735]">Coverage by dimension</h3>
                  </div>
                  <Route className="size-5 text-[#5b8c85]" />
                </div>
                <div className="mt-6 space-y-5">
                  {signalMix.map((signal) => (
                    <div key={signal.label}>
                      <div className="mb-2 flex items-center justify-between text-sm">
                        <span className="font-medium text-[#395653]">{signal.label}</span>
                        <span className="font-semibold tabular-nums text-[#173735]">{signal.value}%</span>
                      </div>
                      <Progress value={signal.value} aria-label={signal.label + " signal coverage"} className={"h-2 bg-[#edf2f1] " + signal.color} />
                    </div>
                  ))}
                </div>
                <p className="mt-6 rounded-2xl bg-[#f2f6f4] px-4 py-3 text-xs leading-relaxed text-[#667875]">
                  Example dimensions shown for layout only. These labels can flex as the measurement model is finalized.
                </p>
              </article>

              <article className="flex items-center gap-4 rounded-[22px] bg-[#fee9d8] p-5 text-[#5b3824] shadow-[0_12px_30px_rgba(94,55,31,0.06)]">
                <div className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-white/65">
                  <HeartPulse className="size-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Recovery is your next leverage point</p>
                  <p className="mt-1 text-xs leading-relaxed text-[#7d5b47]">Two calmer evenings could lift next week’s baseline.</p>
                </div>
              </article>
            </div>
          </section>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
