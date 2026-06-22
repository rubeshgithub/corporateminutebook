import React, { useEffect, useRef } from 'react';
import { TextField } from '@mui/material';
import type { TextFieldProps } from '@mui/material';

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
};

const API_KEY = (import.meta as any).env?.VITE_GOOGLE_PLACES_API_KEY as string | undefined;

// Module-level script loader — only loads once across all instances
let scriptState: 'idle' | 'loading' | 'ready' = 'idle';
const pendingCallbacks: Array<() => void> = [];

function loadPlacesScript(cb: () => void) {
    if (!API_KEY) return; // no key — silently skip
    if (scriptState === 'ready') { cb(); return; }
    pendingCallbacks.push(cb);
    if (scriptState === 'loading') return;
    scriptState = 'loading';
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${API_KEY}&libraries=places`;
    s.async = true;
    s.onload = () => {
        scriptState = 'ready';
        pendingCallbacks.splice(0).forEach((fn) => fn());
    };
    document.head.appendChild(s);
}

function parseComponents(components: any[]): Omit<ParsedAddress, 'formatted'> {
    const get = (type: string) =>
        components.find((c) => c.types.includes(type))?.long_name ?? '';
    return {
        street: [get('street_number'), get('route')].filter(Boolean).join(' '),
        city: get('locality') || get('sublocality_level_1') || get('administrative_area_level_3'),
        province: get('administrative_area_level_1'),
        postalCode: get('postal_code'),
        country: get('country'),
    };
}

const PlacesTextField = React.forwardRef<HTMLDivElement, PlacesTextFieldProps>(
    ({ onPlaceSelected, onChange, ...props }, ref) => {
        const inputRef = useRef<HTMLInputElement>(null);
        const acRef = useRef<any>(null);

        useEffect(() => {
            if (!API_KEY) return;
            loadPlacesScript(() => {
                const g = (window as any).google;
                if (!inputRef.current || !g?.maps?.places) return;
                const ac = new g.maps.places.Autocomplete(inputRef.current, {
                    types: ['address'],
                    componentRestrictions: { country: 'ca' },
                });
                acRef.current = ac;
                ac.addListener('place_changed', () => {
                    const place = ac.getPlace();
                    if (!place?.address_components) return;
                    const parts = parseComponents(place.address_components);
                    const result: ParsedAddress = { ...parts, formatted: place.formatted_address ?? '' };
                    onPlaceSelected?.(result);
                    // fire react-hook-form's onChange with the street value
                    if (onChange) {
                        const evt = { target: { value: parts.street || place.formatted_address } } as React.ChangeEvent<HTMLInputElement>;
                        onChange(evt);
                    }
                });
            });
            return () => {
                const g = (window as any).google;
                if (acRef.current && g?.maps?.event) {
                    g.maps.event.clearInstanceListeners(acRef.current);
                }
            };
        }, []); // eslint-disable-line react-hooks/exhaustive-deps

        return <TextField {...props} onChange={onChange} inputRef={inputRef} ref={ref} />;
    },
);

PlacesTextField.displayName = 'PlacesTextField';
export default PlacesTextField;
