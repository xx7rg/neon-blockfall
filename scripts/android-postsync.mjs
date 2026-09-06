// Executado depois de `cap sync android`. A pasta android/ é descartável (o CI
// recria toda vez), então os ajustes nativos que a Play Store exige são
// re-aplicados aqui de forma idempotente:
//   1. AdMob APPLICATION_ID + flags de otimização no AndroidManifest
//      (sem o App ID o app fecha ao abrir)
//   2. versionCode / versionName vindos do package.json (+ env ANDROID_VERSION_CODE)
//   3. signingConfig de release lendo android/keystore.properties, se existir
//      (o CI escreve esse arquivo a partir dos segredos; sem ele, nada muda)
//
// Se a pasta android/ não existir, não faz nada.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ADMOB_APP_ID = "ca-app-pub-2635930849231174~7000204339";
const ANDROID_DIR = resolve("android");
const MANIFEST = resolve(ANDROID_DIR, "app/src/main/AndroidManifest.xml");
const APP_GRADLE = resolve(ANDROID_DIR, "app/build.gradle");

if (!existsSync(ANDROID_DIR)) {
  console.log("[android-postsync] android/ ausente — nada a fazer.");
  process.exit(0);
}

/* ---------- 1. AndroidManifest: AdMob App ID + flags ---------- */
if (existsSync(MANIFEST)) {
  let xml = readFileSync(MANIFEST, "utf8");
  const before = xml;
  const metas = [
    `<meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" android:value="${ADMOB_APP_ID}"/>`,
    `<meta-data android:name="com.google.android.gms.ads.flag.OPTIMIZE_INITIALIZATION" android:value="true"/>`,
    `<meta-data android:name="com.google.android.gms.ads.flag.OPTIMIZE_AD_LOADING" android:value="true"/>`,
  ];
  for (const meta of metas) {
    const name = meta.match(/android:name="([^"]+)"/)[1];
    xml = xml.replace(
      new RegExp(`\\s*<meta-data android:name="${name.replace(/\./g, "\\.")}"[^>]*/>`, "g"),
      ""
    );
    xml = xml.replace(/(<application\b[^>]*>)/, `$1\n        ${meta}`);
  }
  if (xml !== before) {
    writeFileSync(MANIFEST, xml);
    console.log("[android-postsync] AndroidManifest: AdMob App ID + flags aplicados.");
  } else {
    console.log("[android-postsync] AndroidManifest: já estava atualizado.");
  }
}

/* ---------- 2 + 3. app/build.gradle: versão + assinatura de release ---------- */
if (existsSync(APP_GRADLE)) {
  const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
  const versionName = pkg.version || "1.0.0";
  // versionCode: ANDROID_VERSION_CODE (CI) ou derivado do semver (1.2.3 -> 10203)
  const [maj = 0, min = 0, pat = 0] = versionName.split(".").map((n) => parseInt(n, 10) || 0);
  const versionCode = Number(process.env.ANDROID_VERSION_CODE) || maj * 10000 + min * 100 + pat;

  let g = readFileSync(APP_GRADLE, "utf8");
  const before = g;

  g = g.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`);
  g = g.replace(/versionName\s+"[^"]*"/, `versionName "${versionName}"`);

  // signingConfigs.release — lê android/keystore.properties se existir
  const signingBlock = `    signingConfigs {
        release {
            def kp = new Properties()
            def kf = rootProject.file("keystore.properties")
            if (kf.exists()) {
                kf.withInputStream { kp.load(it) }
                storeFile rootProject.file(kp.getProperty("storeFile"))
                storePassword kp.getProperty("storePassword")
                keyAlias kp.getProperty("keyAlias")
                keyPassword kp.getProperty("keyPassword")
            }
        }
    }
`;
  if (!g.includes("signingConfigs {")) {
    // insere logo após "android {"
    g = g.replace(/(android\s*\{\s*\n)/, `$1${signingBlock}`);
  }

  // usa a assinatura de release só quando o keystore.properties existir
  if (!g.includes("signingConfig signingConfigs.release")) {
    g = g.replace(
      /(buildTypes\s*\{\s*\n\s*release\s*\{\s*\n)/,
      `$1            if (rootProject.file("keystore.properties").exists()) {\n                signingConfig signingConfigs.release\n            }\n`
    );
  }

  if (g !== before) {
    writeFileSync(APP_GRADLE, g);
    console.log(
      `[android-postsync] build.gradle: v${versionName} (code ${versionCode}) + signingConfig de release.`
    );
  } else {
    console.log("[android-postsync] build.gradle: já estava atualizado.");
  }
}
