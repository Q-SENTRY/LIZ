#!/usr/bin/env bash
# Compila Folio.apk sin Android Studio ni Gradle.
# Requisitos (Ubuntu/Debian): sudo apt-get install -y openjdk-17-jdk android-sdk-platform-23 aapt zipalign apksigner dalvik-exchange
set -euo pipefail
cd "$(dirname "$0")"
ROOT=..
ANDROID_JAR=${ANDROID_JAR:-/usr/lib/android-sdk/platforms/android-23/android.jar}
VERSION_NAME=${VERSION_NAME:-$(grep -o '"version": *"[^"]*"' ../package.json 2>/dev/null | grep -o '[0-9][^"]*' || echo 1.0)}
VERSION_CODE=${VERSION_CODE:-$(git rev-list --count HEAD 2>/dev/null || echo 1)}
KEYSTORE=${KEYSTORE:-folio-release.jks}
OUT=${OUT:-$ROOT/dist/Folio.apk}
B=build

rm -rf "$B" && mkdir -p "$B/gen" "$B/classes" "$B/assets/www"

echo "› Copiando la app web"
cp "$ROOT/index.html" "$ROOT/manifest.webmanifest" "$B/assets/www/"
cp -r "$ROOT/css" "$ROOT/js" "$ROOT/vendor" "$ROOT/fonts" "$ROOT/icons" "$ROOT/assets" "$B/assets/www/"
rm -f "$B/assets/www/fonts/"LICENSE-*.txt

echo "› Recursos (R.java)"
aapt package -f -m -J "$B/gen" -M AndroidManifest.xml -S res -I "$ANDROID_JAR"

echo "› Compilando Java"
javac -nowarn --release 8 -encoding UTF-8 -classpath "$ANDROID_JAR" -d "$B/classes" \
  $(find src "$B/gen" -name '*.java') 2>&1 | grep -v "^warning: \[options\]" || true
test -f "$B/classes/app/folio/docs/MainActivity.class"

echo "› Convirtiendo a DEX"
dalvik-exchange --dex --min-sdk-version=24 --output="$B/classes.dex" "$B/classes"

echo "› Empaquetando"
aapt package -f -M AndroidManifest.xml -S res -A "$B/assets" -I "$ANDROID_JAR" \
  --min-sdk-version 24 --target-sdk-version 34 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  -0 arsc -F "$B/unsigned.apk"
(cd "$B" && aapt add -f unsigned.apk classes.dex >/dev/null)

echo "› Alineando"
zipalign -f -p 4 "$B/unsigned.apk" "$B/aligned.apk"

echo "› Firmando"
if [ ! -f "$KEYSTORE" ]; then
  keytool -genkeypair -keystore "$KEYSTORE" -alias folio -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "${KS_PASS:-folio-app}" -keypass "${KS_PASS:-folio-app}" -dname "CN=Folio, O=Folio, C=CO" >/dev/null 2>&1
fi
mkdir -p "$(dirname "$OUT")"
apksigner sign --ks "$KEYSTORE" --ks-key-alias folio --ks-pass "pass:${KS_PASS:-folio-app}" \
  --min-sdk-version 24 --out "$OUT" "$B/aligned.apk"
apksigner verify --min-sdk-version 24 "$OUT"
echo "✓ Listo: $OUT ($(du -h "$OUT" | cut -f1))"
