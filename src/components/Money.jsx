import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useCurrentProfile } from '../context/ProfileContext.jsx';
import ProfilePaymentDetails from './ProfilePaymentDetails';
import ConnectPayoutSetup from './ConnectPayoutSetup.jsx';
import ProSubscription from './ProSubscription.jsx';
import OutstandingClaims from './OutstandingClaims.jsx';
import MyExpenses from './MyExpenses.jsx';
import MyIncome from './MyIncome.jsx';
import MyMileage from './MyMileage.jsx';
import TaxRecords from './TaxRecords.jsx';

// Everything money-related from the old single MyProfile.jsx page.
// ConnectPayoutSetup and ProfilePaymentDetails both need the same
// get_payment_details row -- fetched once here and passed to both,
// exactly as it was on the old page (that consolidation is what this
// split has to preserve, not undo -- see the plan this came from).
export default function Money() {
  const { profile, isAdmin } = useCurrentProfile();
  const userId = profile?.id || null;
  const [paymentDetails, setPaymentDetails] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    supabase.rpc('get_payment_details', { p_profile_id: userId }).maybeSingle()
      .then(({ data }) => {
        setPaymentDetails(data || null);
        setLoading(false);
      });
  }, [userId]);

  if (loading) return <p className="state-message">Loading…</p>;

  return (
    <>
      <div className="section-header">
        <h2 className="section-header__title">Money</h2>
      </div>

      <ProSubscription />
      {/* Temporarily admin-only -- automatic Stripe payouts is still in
          test and not fully finished, and a musician setting it up right
          above the plain bank-details section below confused them into
          thinking it was part of just adding their bank details for
          invoicing. Re-open to everyone once it's ready. */}
      {userId && isAdmin && <ConnectPayoutSetup paymentDetails={paymentDetails} />}
      {userId && <ProfilePaymentDetails profileId={userId} paymentDetails={paymentDetails} />}
      {userId && <OutstandingClaims profileId={userId} />}

      {/* Everything above is getting paid; everything below is your own
          Making Tax Digital record-keeping -- different enough purposes
          that they read as two groups, not one long stack. */}
      <div className="money-group-divider">Making Tax Digital records</div>
      {userId && <MyExpenses profileId={userId} />}
      {userId && <MyIncome profileId={userId} />}
      {userId && <MyMileage profileId={userId} />}
      {userId && <TaxRecords profileId={userId} />}
    </>
  );
}
