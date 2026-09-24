// Route all MagicDNS peers and ports through the authenticated GOST relay.
// Do not add DIRECT as a fallback for matching tailnet destinations.
function FindProxyForURL(url, host) {
  var suffix = ".mora-rattlesnake.ts.net";
  if (host.length > suffix.length &&
      host.substring(host.length - suffix.length) === suffix) {
    return "PROXY 127.0.0.1:1055";
  }
  return "DIRECT";
}
