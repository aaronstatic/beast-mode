export type FeaturePaneTask = { title: string; isDone: boolean }
export type FeaturePanePhase = { title: string; done: number; total: number; tasks: FeaturePaneTask[] }
export type FeaturePaneBug = { id: string; title: string; file: string }
export type FeaturePaneView = {
  root: string
  path: string
  linkKeys: string[]
  status: string | null
  progress: string | null
  phase: FeaturePanePhase | null
  note: string | null
  bugs: FeaturePaneBug[]
}

export type DashboardPaneRoute =
  | { kind: 'project' }
  | { kind: 'epic', epic: string }
  | { kind: 'feature', path: string }
  | { kind: 'bug', file: string }

export type DashboardPaneProgress = { done: number, total: number }

export type DashboardPaneRow = {
  name: string
  path: string
  kind: 'feature' | 'epic' | 'missing'
  status: string | null
  progress: DashboardPaneProgress | null
  isListed: boolean
}

export type DashboardPaneFolder = { name: string, isEpic: boolean }
export type DashboardPaneBugRef = { file: string, row: string }

export type DashboardPaneProjectView = {
  kind: 'project'
  project: string
  source: 'table' | 'noTable' | 'noFile'
  updated: string | null
  folders: DashboardPaneFolder[]
  rows: DashboardPaneRow[]
  links: Record<string, string>
  bugs: DashboardPaneBugRef[]
}

export type DashboardPaneEpicView = {
  kind: 'epic'
  epic: string
  status: string | null
  source: 'table' | 'noTable'
  updated: string | null
  children: string[]
  rows: DashboardPaneRow[]
  links: Record<string, string>
  bugs: DashboardPaneBugRef[]
}

export type DashboardPaneFeatureView = {
  kind: 'feature'
  feature: FeaturePaneView
  phases: FeaturePanePhase[]
  expanded: number[]
}

export type DashboardPaneField = { key: string, value: string }

export type DashboardPaneBugView = {
  kind: 'bug'
  file: string
  id: string
  title: string
  fields: DashboardPaneField[]
  body: string
  note: string | null
}

export type DashboardPaneView =
  | DashboardPaneProjectView
  | DashboardPaneEpicView
  | DashboardPaneFeatureView
  | DashboardPaneBugView

export type DashboardPaneState = {
  root: string
  route: DashboardPaneRoute
  back: DashboardPaneRoute[]
  view: DashboardPaneView
}

declare module 'claude-code' {
  interface PluginState {
    'beast-mode': {
      featurePane: Shaped<FeaturePaneView | null>
      dashboardPane: Shaped<DashboardPaneState | null>
    }
  }
}
