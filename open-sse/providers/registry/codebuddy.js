const codebuddy = {
  id: "codebuddy",
  alias: "cb",
  uiAlias: "cb",
  hidden: false,
  priority: 89,
  display: {
    name: "CodeBuddy",
    icon: "smart_toy",
    color: "#6A5CFF",
    website: "https://www.codebuddy.ai",
    notice: {
      signupUrl: "https://www.codebuddy.ai",
    },
  },
  category: "oauth",
  authModes: ["oauth", "apikey"],
  hasOAuth: true,
  transport: {
    baseUrl: "https://www.codebuddy.ai/v2/chat/completions",
    forceStream: true,
    headers: {
      "User-Agent": "CLI/2.105.2 CodeBuddy/2.105.2",
      "X-App": "cli",
      "X-Stainless-Runtime": "node",
      "X-Stainless-Lang": "js",
      "X-Stainless-Helper-Method": "stream",
      "X-Stainless-Retry-Count": "0",
      "X-Requested-With": "XMLHttpRequest",
      "X-IDE-Type": "CLI",
      "X-IDE-Name": "CLI",
      "X-IDE-Version": "2.105.2",
      "X-Private-Data": "false",
      "X-Domain": "www.codebuddy.ai",
    },
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
    },
    usage: {
      url: "https://www.codebuddy.ai/v2/billing/meter/get-user-resource",
    },
  },
  models: [
    { id: "default-model", name: "Default Model" },
  ],
  oauth: {
    baseUrl: "https://www.codebuddy.ai",
    stateUrl: "https://www.codebuddy.ai/v2/plugin/auth/state",
    tokenUrl: "https://www.codebuddy.ai/v2/plugin/auth/token",
    refreshUrl: "https://www.codebuddy.ai/v2/plugin/auth/token/refresh",
    userAgent: "CLI/2.105.2 CodeBuddy/2.105.2",
    platform: "CLI",
    pollInterval: 5000,
  },
  features: {
    usage: true,
    usageApikey: true,
  },
};

export default codebuddy;
