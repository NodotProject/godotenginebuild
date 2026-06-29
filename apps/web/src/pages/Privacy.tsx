import { LegalPage } from "./LegalPage.js";

export function Privacy() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        Custom Godot Builds is a free tool that compiles Godot export templates on demand. We keep
        data collection to the minimum needed to run the service. This policy explains what is
        processed and why.
      </p>

      <h2>What we process</h2>
      <ul>
        <li>
          <strong>Build configurations.</strong> The engine version, target platforms and feature
          options you submit are processed to compile your template. Configurations are hashed into
          an anonymous cache key; identical requests reuse a cached result. Configurations are not
          linked to your identity.
        </li>
        <li>
          <strong>Request metadata.</strong> Server logs temporarily record IP address, timestamp,
          requested path and response status. This is used only to operate the service, enforce
          rate limits, and prevent abuse.
        </li>
        <li>
          <strong>Local browser storage.</strong> Your build history is stored in your browser's
          localStorage on your own device. It never leaves your browser and you can clear it at any
          time from the history panel.
        </li>
      </ul>

      <h2>What we do not do</h2>
      <ul>
        <li>No accounts, no sign-in, and no advertising or third-party tracking.</li>
        <li>We do not sell or share personal data.</li>
        <li>We do not use cookies for tracking.</li>
      </ul>

      <h2>Retention</h2>
      <p>
        Server request logs are retained only as long as needed for operations and abuse prevention,
        then rotated out. Cached build artifacts are evicted automatically once storage limits are
        reached.
      </p>

      <h2>Your choices</h2>
      <p>
        You can clear your local build history at any time. For questions about this policy or to
        request information, contact the operator via the project's repository.
      </p>

      <p className="text-slate-500">
        This is a best-effort privacy summary for a community tool, not legal advice. Operators
        deploying this service should adapt it to their jurisdiction.
      </p>
    </LegalPage>
  );
}
