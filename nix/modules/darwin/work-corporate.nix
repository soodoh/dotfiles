{ host, lib, ... }:
let
  certificateBundle = "/Library/Application Support/DocuSign/zscaler-ca-bundle.pem";
in
{
  config = lib.mkIf (host.profile == "work") {
    # Corporate endpoint management owns /etc/zshenv and may reconcile it at
    # any time. Leave that path unmanaged instead of replacing it with a Nix
    # store link. The variables below also make the same certificate policy
    # available to the Nix-managed Fish login shell.
    environment = {
      etc."zshenv".enable = false;
      variables = {
        REQUESTS_CA_BUNDLE = certificateBundle;
        NODE_EXTRA_CA_CERTS = certificateBundle;
        SSL_CERT_FILE = certificateBundle;
        AWS_CA_BUNDLE = certificateBundle;
        CURL_CA_BUNDLE = certificateBundle;
        HTTPLIB2_CA_CERTS = certificateBundle;
      };
    };

    # Root Nix and Comin must use the machine-local corporate bundle without
    # importing it into the otherwise pure flake evaluation.
    nix.envVars.NIX_SSL_CERT_FILE = certificateBundle;
    launchd.daemons.comin.serviceConfig.EnvironmentVariables = {
      NIX_SSL_CERT_FILE = certificateBundle;
      SSL_CERT_FILE = certificateBundle;
      GIT_SSL_CAINFO = certificateBundle;
      CURL_CA_BUNDLE = certificateBundle;
    };
  };
}
