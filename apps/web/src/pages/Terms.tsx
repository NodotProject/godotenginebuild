import { LegalPage } from "./LegalPage.js";

export function Terms() {
  return (
    <LegalPage title="Terms of Use">
      <p>
        By using Custom Godot Builds you agree to these terms. The service is provided free of
        charge and on a best-effort basis.
      </p>

      <h2>The service</h2>
      <p>
        This tool compiles Godot Engine export templates from the official Godot source using a
        curated set of build options you select. Builds run on shared infrastructure and are cached
        and shared between users with identical configurations.
      </p>

      <h2>Acceptable use</h2>
      <ul>
        <li>Do not attempt to overload, disrupt, or circumvent the rate limits of the service.</li>
        <li>Do not use automated scripts to mass-generate builds.</li>
        <li>Do not use the service for any unlawful purpose.</li>
      </ul>
      <p>
        We may throttle, queue, or refuse requests to keep the service available for everyone, and
        may remove cached artifacts at any time.
      </p>

      <h2>No warranty</h2>
      <p>
        The service and the binaries it produces are provided <strong>"as is"</strong>, without
        warranty of any kind, express or implied. We do not guarantee that builds are error-free,
        fit for a particular purpose, or continuously available. You are responsible for verifying
        any artifact (checksums are provided) before use.
      </p>

      <h2>Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, the operators and contributors are not liable for
        any damages arising from the use of this service or the artifacts it produces.
      </p>

      <h2>Godot Engine</h2>
      <p>
        Godot Engine is free and open-source software licensed under the MIT License and is a
        trademark of the Godot Foundation. Compiled templates remain subject to Godot's own license.
        This service is independent and not affiliated with or endorsed by the Godot project.
      </p>

      <h2>Source</h2>
      <p>
        This tool is open source under the MIT License. See the project repository for the code and
        to report issues.
      </p>
    </LegalPage>
  );
}
