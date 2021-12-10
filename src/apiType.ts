interface webhook {
    "type": "webhook",
    "meta": {
        "id": string,
        "bucked_id": string,
        "bucket_name": string,
        "input_id": string,
        "input_name": string,
        "output_name": string,
        "output_destination": string
    },
    "headers": {
        [k: string]: string[]
    },
    "query": string,
    "body": string,
    "method": "GET" | "HEAD" | "POST" | "PUT" | "DELETE" | "CONNECT" | "OPTIONS" | "TRACE" | "PATCH"
}
interface status {
    "type": "status",
    "status": string,
    "message": string
}
type api = webhook | status;
export default api;