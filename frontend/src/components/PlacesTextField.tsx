import React, { useEffect, useRef, useState, useCallback } from 'react';
import { TextField } from '@mui/material';
import type { TextFieldProps } from '@mui/material';

/**
 * Google Places autocomplete-backed street-address field.
 *
 * Migration note: the old `google.maps.places.Autocomplete` class was
 * deprecated in early 2024 in favor of `PlaceAutocompleteElement`, a Web
 * Component. Google publishes a sunset target around 2027, but the new
 * API is already GA and works well — this component uses it now so we
 * don't hit a scramble later.
 *
 * Design constraints:
 *   - Callers pass react-hook-form's Controller `{...field}` plus MUI
 *     TextField props. We must preserve that surface so existing
 *     forms (MinuteBookBuilder + DocumentManagement) don't need changes.
 *   - `PlaceAutocompleteElement` renders its own text input inside a
 *     shadow DOM. We can't inject it into MUI's `<input>` — we render
 *     it into a container, hide the MUI TextField's input visually,
 *     and let the Web Component be the interactive input while MUI
 *     provides the label + border + error styling.
 *   - Silently degrades to a plain MUI TextField when no API key is
 *     set (dev without VITE_GOOGLE_PLACES_API_KEY).
 */

export interface ParsedAddress {
    street: string;
    city: string;
    province: string;
    postalCode: string;
    country: string;
    formatted: string;
}

type PlacesTextFieldProps = TextFieldProps & {
    onPlaceSelected?: (address: ParsedAddress) => void;
    /** Suggest addresses worldwide instead of Canada-only — for directors/shareholders residing abroad. */
    worldwide?: boolean;
};

const API_KEY = (import.meta as any).env?.VITE_GOOGLE_PLACES_API_KEY as string | undefined;

/**
 * Module-level loader for the Places library. Uses the modern
 * `importLibrary` pattern instead of injecting a <script> tag with
 * a legacy `libraries=places` query string. Cached so subsequent
 * component mounts don't re-request.
 */
let loaderPromise: Promise<any> | null = null;

function loadPlacesLibrary(): Promise<any> {
    if (!API_KEY) return Promise.reject(new Error('No API key'));
    if (loaderPromise) return loaderPromise;

    loaderPromise = new Promise((resolve, reject) => {
        // If the Maps loader script isn't on the page, inject it once.
        // The v=weekly channel gets us the current PlaceAutocompleteElement.
        // `loading=async` silences the deprecation warning from google.
        const w = window as any;
        if (w.google?.maps?.importLibrary) {
            w.google.maps.importLibrary('places').then(resolve).catch(reject);
            return;
        }
        // Google's officially recommended loader bootstrap. This shape
        // installs `google.maps.importLibrary` and lazy-loads sub-libraries
        // on demand. See: https://developers.google.com/maps/documentation/javascript/load-maps-js-api
        ((g: any) => {
            const h = (window as any).google || ((window as any).google = { maps: {} });
            const c = h.maps || (h.maps = {});
            let a: Promise<any> | undefined;
            c.importLibrary = c.importLibrary || ((f: string) => a ? a.then((r) => r(f)) : (a = new Promise((r, s) => {
                const d = document.createElement('script');
                d.async = true;
                d.src = `https://maps.googleapis.com/maps/api/js?key=${g.key}&v=weekly&loading=async`;
                d.onerror = () => { loaderPromise = null; s(new Error('Places script failed to load')); };
                d.onload = () => { r((h.maps as any).importLibrary); };
                document.head.appendChild(d);
            })).then((im: any) => im(f)));
        })({ key: API_KEY });

        (window as any).google.maps.importLibrary('places').then(resolve).catch(reject);
    });

    return loaderPromise;
}

/** Extract normalized address parts from the new API's AddressComponent[]. */
function parseComponents(components: any[]): Omit<ParsedAddress, 'formatted'> {
    const get = (type: string) => {
        // The new API uses .types (array) + .longText / .shortText
        const comp = components.find((c) => (c.types ?? []).includes(type));
        return comp?.longText ?? comp?.long_name ?? '';
    };
    return {
        street:     [get('street_number'), get('route')].filter(Boolean).join(' '),
        city:       get('locality') || get('sublocality_level_1') || get('administrative_area_level_3'),
        province:   get('administrative_area_level_1'),
        postalCode: get('postal_code'),
        country:    get('country'),
    };
}

const PlacesTextField = React.forwardRef<HTMLDivElement, PlacesTextFieldProps>(
    ({ onPlaceSelected, worldwide, onChange, value, ...props }, ref) => {
        const containerRef = useRef<HTMLDivElement>(null);
        const elementRef   = useRef<any>(null);
        const [ready, setReady] = useState(false);

        // Fire a synthetic ChangeEvent for react-hook-form so the field's
        // Controller stays in sync with whatever's in the visible input.
        const fireOnChange = useCallback((str: string) => {
            if (!onChange) return;
            const evt = { target: { value: str } } as React.ChangeEvent<HTMLInputElement>;
            onChange(evt);
        }, [onChange]);

        useEffect(() => {
            if (!API_KEY) return;
            let cancelled = false;
            loadPlacesLibrary()
                .then((placesLib: any) => {
                    if (cancelled || !containerRef.current) return;
                    const el = new placesLib.PlaceAutocompleteElement({
                        // Company addresses stay Canada-only; directors and
                        // shareholders may reside anywhere.
                        ...(worldwide ? {} : { includedRegionCodes: ['ca'] }),
                        types: ['address'],
                    });
                    // Reasonable defaults that mimic the old inline input.
                    el.style.width = '100%';
                    el.style.height = '100%';
                    containerRef.current.appendChild(el);
                    elementRef.current = el;

                    // User picked a suggestion — fetch address components + notify.
                    el.addEventListener('gmp-select', async (event: any) => {
                        try {
                            const place = event.placePrediction?.toPlace?.();
                            if (!place) return;
                            await place.fetchFields({ fields: ['addressComponents', 'formattedAddress'] });
                            const parts = parseComponents(place.addressComponents ?? []);
                            const result: ParsedAddress = {
                                ...parts,
                                formatted: place.formattedAddress ?? '',
                            };
                            onPlaceSelected?.(result);
                            fireOnChange(parts.street || result.formatted);
                        } catch {
                            /* selection ignored on error */
                        }
                    });
                    setReady(true);
                })
                .catch(() => { /* silently fall through to plain TextField */ });

            return () => {
                cancelled = true;
                if (elementRef.current) {
                    try { elementRef.current.remove(); } catch { /* noop */ }
                    elementRef.current = null;
                }
            };
        // eslint-disable-next-line react-hooks/exhaustive-deps
        }, []);

        // No API key OR the library failed to load: render a plain TextField so
        // the form remains usable. Callers can still type addresses manually.
        if (!API_KEY) {
            return <TextField {...props} value={value ?? ''} onChange={onChange} ref={ref} />;
        }

        return (
            <TextField
                {...props}
                ref={ref}
                value={value ?? ''}
                onChange={onChange}
                InputProps={{
                    inputComponent: React.forwardRef<HTMLInputElement, any>(
                        (_inputProps, _r) => (
                            // The Web Component lives inside the MUI outlined
                            // input area. We hide MUI's default <input> visually
                            // and let PlaceAutocompleteElement's own text field
                            // take over. Height matches MUI's small/medium inputs.
                            <div
                                ref={containerRef}
                                style={{
                                    width: '100%',
                                    minHeight: 23,
                                    display: 'flex',
                                    alignItems: 'center',
                                    visibility: ready ? 'visible' : 'hidden',
                                }}
                            />
                        ),
                    ),
                }}
            />
        );
    },
);

PlacesTextField.displayName = 'PlacesTextField';
export default PlacesTextField;
