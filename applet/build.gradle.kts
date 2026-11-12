// NearCash Java Card applet.
//
// Source sets:
//  - main: the applet itself (package xyz.nektarlabs.nearcash). This is the
//          only code that goes on the card, so it must stay Java Card
//          compatible (byte/short arithmetic only, no java.lang beyond the
//          Java Card subset).
//  - test: JUnit tests that run the applet inside jCardSim, the Java Card
//          simulator, and verify signatures with BouncyCastle. Everything
//          else in the project talks to real cards only.
//
// The .cap for real cards (NXP JCOP4 J3R180): `./gradlew cap`, the task at
// the end. `pnpm test:card` builds it, writes it on a card, tests the card and
// resets it.

plugins {
    java
}

repositories {
    mavenCentral()
}

// jCardSim implements the Java Card 3.0.5 API (same version as JCOP4 J3R180),
// including Signature.signPreComputedHash, which SIGN_ONCE needs.
val jcardsimVersion = "3.0.5.11"

dependencies {
    // The applet compiles against the javacard.* API classes shipped inside
    // jCardSim. They are provided by the card at runtime, hence compileOnly.
    compileOnly("com.klinec:jcardsim:$jcardsimVersion")

    testImplementation("com.klinec:jcardsim:$jcardsimVersion")
    testImplementation("org.bouncycastle:bcprov-jdk18on:1.85")
    testImplementation(platform("org.junit:junit-bom:6.1.2"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.named<JavaCompile>("compileJava") {
    // Conservative bytecode level for card code. The real CAP conversion will
    // use the Java Card SDK toolchain; this only keeps us honest meanwhile.
    options.release.set(8)
    options.encoding = "UTF-8"
}

// The tests are host-side code: modern Java is fine (and javax.smartcardio,
// used by jCardSim, is not visible with --release 8).
tasks.named<JavaCompile>("compileTestJava") {
    options.release.set(17)
    options.encoding = "UTF-8"
}

tasks.test {
    useJUnitPlatform()
    testLogging {
        events("passed", "failed", "skipped")
        showStandardStreams = false
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
    }
}

// ------------------------------------------------------------------ the .cap
// The applet for real cards (NXP JCOP4 J3R180, Java Card 3.0.5), built with
// ant-javacard and Oracle's Java Card SDK. Both live in .javacard/
// (git-ignored), downloaded at pinned versions by scripts/card-test.sh.
// Which SDK depends on the JDK Gradle runs on: SDK 3.0.5u4's tools run on JDK
// 8 to 17; on a newer JDK, SDK 3.2 (v26.0) builds the same 3.0.5 applet
// (ant-javacard's target).
//
//   ./gradlew cap                                                      JDK 17 → SDK 3.0.5u4
//   ./gradlew cap -PjavacardKit=jc320v26.0_kit -PjavacardTarget=3.0.5   newer JDK
//
// Output: build/cap/nearcash.cap. The AIDs are the protocol's
// (docs/protocol.md §3): package F04E42414E4B, applet F04E42414E4B01. The
// package version follows PROTOCOL_VERSION (2).
val javacardTools = layout.projectDirectory.dir(".javacard")
tasks.register("cap") {
    group = "build"
    description = "Builds the applet's .cap for real Java Card 3.0.5 cards (JCOP4 J3R180)."
    val sources = layout.projectDirectory.dir("src/main/java")
    val antJavacard = javacardTools.file("ant-javacard.jar").asFile
    val kitName = (findProperty("javacardKit") as String?) ?: "jc305u4_kit"
    val target = findProperty("javacardTarget") as String?
    val kit = javacardTools.dir("sdks/$kitName").asFile
    val cap = layout.buildDirectory.file("cap/nearcash.cap")
    inputs.dir(sources)
    inputs.property("kit", kitName)
    inputs.property("target", target ?: "")
    outputs.file(cap)
    doLast {
        check(antJavacard.isFile && kit.isDirectory) {
            "ant-javacard or the Java Card SDK $kitName is missing in ${javacardTools.asFile}: scripts/card-test.sh downloads them"
        }
        val capFile = cap.get().asFile
        capFile.parentFile.mkdirs()
        val capAttributes = mutableListOf(
            "aid" to "F04E42414E4B",
            "package" to "xyz.nektarlabs.nearcash",
            "version" to "2.0",
            "output" to capFile.path,
            "sources" to sources.asFile.path,
        )
        if (target != null) capAttributes += "targetsdk" to target
        ant.withGroovyBuilder {
            "taskdef"("name" to "javacard", "classname" to "pro.javacard.ant.JavaCard", "classpath" to antJavacard.path)
            "javacard"("jckit" to kit.path) {
                "cap"(*capAttributes.toTypedArray()) {
                    "applet"("class" to "xyz.nektarlabs.nearcash.NearCashApplet", "aid" to "F04E42414E4B01")
                }
            }
        }
    }
}
