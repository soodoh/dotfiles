// Relay private *.ts.diloreto.com HTTPS on port 443 only.
// Do not add DIRECT as a fallback for matching private destinations.
function FindProxyForURL(url, host) {
  var name = host.toLowerCase();
  var suffix = ".ts.diloreto.com";
  var authority = /^https:\/\/([^\/?#]+)/i.exec(url);
  if (name.length > suffix.length &&
      name.substring(name.length - suffix.length) === suffix &&
      authority &&
      (authority[1].toLowerCase() === name ||
       authority[1].toLowerCase() === name + ":443")) {
    return "PROXY 127.0.0.1:1055";
  }
  return "DIRECT";
}
