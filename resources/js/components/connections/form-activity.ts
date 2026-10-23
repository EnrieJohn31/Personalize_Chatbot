import { createContext, useContext } from 'react';

type FormActivity = { onStart: () => void; onFinish: () => void };

/**
 * Forms on the Connections page report their submissions, so the page pauses polling meanwhile:
 * a poll racing a submission could take or overwrite the submission's flashed answer.
 */
export const FormActivityContext = createContext<FormActivity>({
    onStart: () => {},
    onFinish: () => {},
});

export const useFormActivity = (): FormActivity =>
    useContext(FormActivityContext);
