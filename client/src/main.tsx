// The print routes never load the app's theme: the PDF is a light document
// whose stylesheet must not compete with the dashboard's own reset.
if (window.location.pathname.startsWith('/print/')) void import('./print/entry');
else void import('./appEntry');
export {};
