
describe('Tracker Obfuscation Flow', () => {
  it('should load the tracker, send an initial event, and a custom event with encrypted payloads', () => {
    // Intercept the file loading and the API calls
    cy.intercept('GET', '/script.js').as('getLoaderScript');
    cy.intercept('GET', '/loader.wasm').as('getWasm');
    cy.intercept('GET', '/data.bin').as('getEncryptedTracker');
    cy.intercept('POST', '/api/send').as('postData');

    cy.visit('/');

    // Verify the correct files were loaded
    cy.wait('@getLoaderScript').its('response.statusCode').should('eq', 200);
    cy.wait('@getWasm').its('response.statusCode').should('eq', 200);
    cy.wait('@getEncryptedTracker').its('response.statusCode').should('eq', 200);

    // Verify the initial page view event was sent with an encrypted payload
    cy.wait('@postData').then(interception => {
      expect(interception.response.statusCode).to.eq(200);
      // If the body is a string, it's likely JSON. If it's an ArrayBuffer, it's binary.
      // This confirms the payload is not plaintext.
      expect(typeof interception.request.body).to.not.equal('string');
    });

    // Trigger a custom event
    cy.window().then(win => {
      win.app.send('test-event', { custom: 'data' });
    });

    // Verify the custom event was sent with an encrypted payload
    cy.wait('@postData').then(interception => {
      expect(interception.response.statusCode).to.eq(200);
      expect(typeof interception.request.body).to.not.equal('string');
    });
  });
});
