interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly VITE_REPO_URL?: string
  readonly VITE_HOSTED?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
