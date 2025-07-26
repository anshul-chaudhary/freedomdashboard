export default async () => {
  return new Response("Hello from Netlify Edge Function!", {
    headers: { "content-type": "text/plain" },
  });
};
