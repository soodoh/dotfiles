{
  lib,
  stdenvNoCC,
}:
stdenvNoCC.mkDerivation {
  pname = "google-calendar";
  version = "1.0.0";
  dontUnpack = true;

  installPhase = ''
    runHook preInstall

    app="$out/Applications/Google Calendar.app"
    mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
    cp ${./ApplicationIcon.icns} "$app/Contents/Resources/ApplicationIcon.icns"

    cat > "$app/Contents/Info.plist" <<'EOF'
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0">
    <dict>
      <key>CFBundleDisplayName</key>
      <string>Google Calendar</string>
      <key>CFBundleExecutable</key>
      <string>google-calendar</string>
      <key>CFBundleIconFile</key>
      <string>ApplicationIcon</string>
      <key>CFBundleIdentifier</key>
      <string>dev.soodoh.google-calendar</string>
      <key>CFBundleInfoDictionaryVersion</key>
      <string>6.0</string>
      <key>CFBundleName</key>
      <string>Google Calendar</string>
      <key>CFBundlePackageType</key>
      <string>APPL</string>
      <key>CFBundleShortVersionString</key>
      <string>1.0.0</string>
      <key>CFBundleVersion</key>
      <string>1</string>
      <key>LSMinimumSystemVersion</key>
      <string>13.0</string>
    </dict>
    </plist>
    EOF

    cat > "$app/Contents/MacOS/google-calendar" <<'EOF'
    #!/bin/sh
    chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    url="https://calendar.google.com/calendar/r"
    if [ -x "$chrome" ]; then
      exec "$chrome" --app="$url"
    fi
    exec /usr/bin/open "$url"
    EOF
    chmod +x "$app/Contents/MacOS/google-calendar"

    runHook postInstall
  '';

  meta = {
    description = "Google Calendar web application launcher";
    homepage = "https://calendar.google.com";
    license = lib.licenses.free;
    platforms = lib.platforms.darwin;
  };
}
