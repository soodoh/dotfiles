{
  host,
  resolveApplicationPackage,
  ...
}:
let
  resolveDockApp =
    app:
    if builtins.isString app then
      app
    else
      "${resolveApplicationPackage app.nixPackage}/Applications/${app.bundle}";
in
{
  system.defaults = {
    CustomUserPreferences.NSGlobalDomain.NSWindowShouldDragOnGesture = true;

    dock = {
      persistent-apps = map resolveDockApp host.applications.dock;
      persistent-others = [ { folder = "${host.homeDirectory}/Downloads"; } ];
      show-recents = false;
    };
  };
}
