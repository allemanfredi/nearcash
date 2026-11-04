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
// Building the .cap file for the real J3R180 needs the Oracle Java Card SDK
// and is not wired in yet (see README, "Real cards").

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
