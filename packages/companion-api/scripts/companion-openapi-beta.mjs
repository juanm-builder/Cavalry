import { generateBetaOpenApiArtifacts, validateGeneratedOpenApi } from './companion-beta-utils.mjs';

function fail(message) {
  console.error('Companion beta OpenAPI generation failed:', message);
  process.exit(1);
}

try {
  const generated = generateBetaOpenApiArtifacts();
  validateGeneratedOpenApi(generated.yamlPath);
  console.log('Companion beta OpenAPI generated:');
  console.log(generated.yamlPath);
  console.log(generated.jsonPath);
} catch (error) {
  fail(error && error.message ? error.message : String(error));
}
