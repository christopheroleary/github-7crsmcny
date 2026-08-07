// Postgres unique_violation, surfaced by PostgREST as error.code on the
// Supabase response. Currently only relevant to the one-doc-per-gig
// constraints on invoices/quotes/contracts -- written for that case.
export function friendlyDbError(error) {
  if (error?.code === '23505') {
    return 'This already exists for this gig — reload the page to see it.';
  }
  return error?.message || 'Something went wrong.';
}
