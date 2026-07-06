import { useState, useEffect, useRef } from 'react';

function formatAddress(feature) {
  const p = feature.properties;
  const namePart = p.name || '';
  const streetPart = [p.housenumber, p.street].filter(Boolean).join(' ');
  let firstLine = '';
  if (namePart && streetPart && namePart !== streetPart) firstLine = namePart + ', ' + streetPart;
  else firstLine = namePart || streetPart;
  const locality = p.city || p.district || '';
  const county = p.county || '';
  const parts = [firstLine, locality, county, p.postcode, p.country]
    .map(s => (s || '').trim()).filter(Boolean);
  // Deduplicate adjacent equal parts (city === county sometimes)
  return parts.filter((v, i) => v !== parts[i - 1]).join(', ');
}

export default function AddressAutocomplete({ value, onChange, onCoordinatesChange, placeholder }) {
  const [query, setQuery] = useState(value || '');
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    setQuery(value || '');
  }, [value]);

  function handleInput(e) {
    const text = e.target.value;
    setQuery(text);
    onChange(text);

    clearTimeout(debounceRef.current);
    if (text.trim().length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        // bias results toward the UK since that's where you're based
        const res = await fetch(
          'https://photon.komoot.io/api?q=' +
            encodeURIComponent(text) +
            '&limit=6&lang=en&bbox=-10.5,49.5,2.0,61.0'
        );
        const data = await res.json();
        const features = (data.features || []).filter((f) => formatAddress(f).trim().length > 0);
        setSuggestions(features);
        setOpen(features.length > 0);
      } catch {
        setSuggestions([]);
        setOpen(false);
      }
    }, 350);
  }

  function handleSelect(feature) {
    const formatted = formatAddress(feature);
    setQuery(formatted);
    onChange(formatted);
    const [lon, lat] = feature.geometry?.coordinates || [];
    if (lat != null && lon != null) onCoordinatesChange?.(lat, lon);
    setSuggestions([]);
    setOpen(false);
  }

  function handleBlur() {
    setTimeout(() => setOpen(false), 150);
  }

  return (
    <div className="address-autocomplete">
      <input
        type="text"
        value={query}
        onChange={handleInput}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onBlur={handleBlur}
        placeholder={placeholder || 'Start typing a venue name or address…'}
        autoComplete="off"
      />
      {open && suggestions.length > 0 && (
        <ul className="address-autocomplete__list">
          {suggestions.map((f, i) => {
            const label = formatAddress(f);
            return (
              <li key={i} onClick={() => handleSelect(f)}>
                {label}
              </li>
            );
          })}
        </ul>
      )}
      <p className="address-autocomplete__credit">Address search by OpenStreetMap</p>
    </div>
  );
}