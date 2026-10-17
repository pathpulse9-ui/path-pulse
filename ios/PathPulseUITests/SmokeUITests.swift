import XCTest

final class SmokeUITests: XCTestCase {
    private let networkTimeout: TimeInterval = 20

    override func setUp() {
        continueAfterFailure = false
    }

    private func text(_ app: XCUIApplication, containing value: String) -> XCUIElement {
        app.staticTexts.containing(NSPredicate(format: "label CONTAINS[c] %@", value)).firstMatch
    }

    func testGuestReachesDashboardAndOffRampAndStaysSignedInAfterRelaunch() {
        let app = XCUIApplication()
        app.launchArguments = ["-PathPulseResetSession"]
        app.launch()

        XCTAssertTrue(app.buttons["Get started"].waitForExistence(timeout: networkTimeout))
        app.buttons["Get started"].tap()

        XCTAssertTrue(app.buttons["Continue as Guest"].waitForExistence(timeout: networkTimeout))
        app.buttons["Continue as Guest"].tap()

        XCTAssertTrue(app.staticTexts["My rewards"].waitForExistence(timeout: networkTimeout))
        app.buttons["Off-ramp"].firstMatch.tap()
        XCTAssertTrue(text(app, containing: "withdrawal").waitForExistence(timeout: networkTimeout))

        app.terminate()
        let relaunched = XCUIApplication()
        relaunched.launch()
        XCTAssertTrue(relaunched.staticTexts["My rewards"].waitForExistence(timeout: networkTimeout))
        XCTAssertFalse(relaunched.buttons["Get started"].exists)
    }
}
