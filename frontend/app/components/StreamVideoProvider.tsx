"use client";

import {
    StreamVideoClient,
    StreamVideo,
    User,
} from "@stream-io/video-react-sdk";
import { useEffect, useState, ReactNode } from "react";

const apiKey = "u4vjvk759jdv"; // This is the API key from the user's .env

export const StreamVideoProvider = ({
    children,
    userId
}: {
    children: ReactNode;
    userId: string | null;
}) => {
    const [client, setClient] = useState<StreamVideoClient | null>(null);

    useEffect(() => {
        if (!userId) return;

        const user: User = { id: userId };
        const videoClient = new StreamVideoClient({ apiKey });

        let isMounted = true;

        const init = async () => {
            try {
                await videoClient.connectUser(user, async () => {
                    const response = await fetch(`http://localhost:8000/stream-token?user_id=${userId}`);
                    if (!response.ok) {
                        const errorText = await response.text();
                        console.error("Token fetch failed:", response.status, errorText);
                        throw new Error(`Failed to fetch token: ${response.status}`);
                    }
                    const data = await response.json();
                    return data.token;
                });

                if (isMounted) {
                    setClient(videoClient);
                }
            } catch (e) {
                console.error("Failed to connect to Stream Video", e);
            }
        };

        init();

        return () => {
            isMounted = false;
            videoClient.disconnectUser();
            setClient(null);
        };
    }, [userId]);

    if (!client) return <>{children}</>;

    return <StreamVideo client={client}>{children}</StreamVideo>;
};
