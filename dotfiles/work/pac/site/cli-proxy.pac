// Keep ordinary browser traffic on the system's existing direct route.
// Do not add DIRECT as a fallback for the protected CLIProxyAPI destination.
function FindProxyForURL(url, host) {
  var endpoint = "https://docker-host.tailea1a78.ts.net:8444/";
  if (host === "docker-host.tailea1a78.ts.net" &&
      url.substring(0, endpoint.length) === endpoint) {
    return "PROXY 127.0.0.1:1055";
  }
  return "DIRECT";
}
