{ host, lib, ... }:
let
  certificateBundle = "/Library/Application Support/DocuSign/zscaler-ca-bundle.pem";
in
{
  environment = lib.mkIf (host.profile == "work") {
    # Corporate endpoint management owns /etc/zshenv and may reconcile it at
    # any time. Leave that path unmanaged instead of replacing it with a Nix
    # store link. The variables below also make the same certificate policy
    # available to the Nix-managed Fish login shell.
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
}
