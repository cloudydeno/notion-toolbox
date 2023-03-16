import { httpTracer, trace, DenoFetchInstrumentation, DenoTracerProvider, OTLPTraceFetchExporter, Resource } from "https://deno.land/x/observability@v0.3.0/mod.ts";
export { httpTracer, trace };

export const provider = new DenoTracerProvider({
  resource: new Resource({
    'service.name': 'natalieetc',
    'service.version': Deno.env.get('DENO_DEPLOYMENT_ID'),
    'deployment.environment': 'production',
    'deployment.region': Deno.env.get('DENO_REGION'),
  }),
  instrumentations: [
    new DenoFetchInstrumentation(),
  ],
  batchSpanProcessors: [
    new OTLPTraceFetchExporter(),
  ],
});
