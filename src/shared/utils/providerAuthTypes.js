export function getProviderAuthTypes(providerInfo, fallbackAuthType) {
  const authTypes = new Set(
    Array.isArray(fallbackAuthType) ? fallbackAuthType : [fallbackAuthType],
  );
  if (providerInfo?.authModes?.includes("oauth")) authTypes.add("oauth");
  if (providerInfo?.authModes?.includes("apikey")) {
    authTypes.add("apikey");
    authTypes.add("api_key");
  }
  return Array.from(authTypes);
}
