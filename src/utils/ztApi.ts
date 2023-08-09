import fs from "fs";
import { prisma } from "~/server/db";
import { IPv4gen } from "./IPv4gen";
import axios, { type AxiosError, type AxiosResponse } from "axios";
import { APIError } from "~/server/helpers/errorHandler";
import {
	type HttpResponse,
	type ZTControllerCreateNetwork,
	type ZTControllerNodeStatus,
	type ZTControllerStatus,
	// type ZTControllerMemberDetails,
	type MemberDeleteInput,
	type MemberDeleteResponse,
	type ZTControllerGetPeer,
} from "~/types/ztController";

import { type CentralControllerStatus } from "~/types/central/controllerStatus";
import { type CentralMemberConfig } from "~/types/central/members";
import {
	type NetworkBase,
	type CentralNetwork,
	type FlattenCentralNetwork,
} from "~/types/central/network";
import { type MemberEntity } from "~/types/local/member";
import { type NetworkEntity } from "~/types/local/network";
import { type NetworkAndMemberResponse } from "~/types/network";

const LOCAL_ZT_ADDR = process.env.ZT_ADDR || "http://127.0.0.1:9993";
const CENTRAL_ZT_ADDR = "https://api.zerotier.com/api/v1";

let ZT_SECRET = process.env.ZT_SECRET;

const ZT_FILE =
	process.env.ZT_SECRET_FILE || "/var/lib/zerotier-one/authtoken.secret";

if (!ZT_SECRET) {
	if (process.env.IS_GITHUB_ACTION !== "true") {
		try {
			ZT_SECRET = fs.readFileSync(ZT_FILE, "utf8");
		} catch (error) {
			console.error("an error occurred while reading the ZT_SECRET");
			console.error(error);
		}
	} else {
		// GitHub Actions
		ZT_SECRET = "dummy_text_to_skip_gh";
	}
}

const getApiCredentials = async () => {
	return await prisma.globalOptions.findFirst({
		where: {
			id: 1,
		},
	});
};
interface GetOptionsResponse {
	ztCentralApiUrl: string | null;
	headers: {
		Authorization?: string;
		"X-ZT1-Auth"?: string;
		"Content-Type": string;
	};
}

const getOptions = async (isCentral = false): Promise<GetOptionsResponse> => {
	if (isCentral) {
		const { ztCentralApiKey, ztCentralApiUrl } = await getApiCredentials();
		return {
			ztCentralApiUrl: ztCentralApiUrl || CENTRAL_ZT_ADDR,
			headers: {
				Authorization: `token ${ztCentralApiKey}`,
				"Content-Type": "application/json",
			},
		};
	}

	return {
		ztCentralApiUrl: null,
		headers: {
			"X-ZT1-Auth": ZT_SECRET,
			"Content-Type": "application/json",
		},
	};
};

export const flattenCentralMember = (member: MemberEntity): MemberEntity => {
	const { id: nodeId, config, ...otherProps } = member;
	const flattenedMember = { nodeId, ...config, ...otherProps };
	return flattenedMember;
};

export const flattenCentralMembers = (
	members: MemberEntity[],
): MemberEntity[] => {
	if (!members) return [];
	return members.map((member) => flattenCentralMember(member));
};

export const flattenNetwork = (
	network: CentralNetwork,
): FlattenCentralNetwork => {
	const { id: nwid, config, ...otherProps } = network;
	const flattenedNetwork = { nwid, ...config, ...otherProps };
	return flattenedNetwork;
};

export const flattenNetworks = (
	networks: CentralNetwork[],
): FlattenCentralNetwork[] => {
	return networks.map((network) => flattenNetwork(network));
};

/*
 *    Axios Helper functions
 *
 */
const getData = async <T>(
	addr: string,
	headers: GetOptionsResponse["headers"],
): Promise<T> => {
	try {
		const { data } = await axios.get<T>(addr, { headers });
		return data;
	} catch (error) {
		if (axios.isAxiosError(error)) {
			const statusCode = error.response?.status;
			if (statusCode === 401) {
				throw new APIError("Invalid API Key", error);
			} else if (statusCode === 404) {
				throw new APIError("Endpoint Not Found", error);
			} // Add more status code checks here if needed
		}
		const message = `An error occurred fetching data from ${addr}`;
		throw new APIError(message, error as AxiosError);
	}
};
const postData = async <T, P = unknown>(
	addr: string,
	headers: GetOptionsResponse["headers"],
	payload: P,
): Promise<T> => {
	try {
		const { data } = await axios.post<T>(addr, payload, { headers });

		return data;
	} catch (error) {
		const message = `An error occurred while posting data to ${addr}`;
		throw new APIError(message, error as AxiosError);
	}
};

/* 
  Controller API for Admin
*/

//Test API
export const ping_api = async function () {
	// get headers based on local or central api
	const { headers, ztCentralApiUrl } = await getOptions(true);
	const addr = `${ztCentralApiUrl}/network`;

	return await getData<ZTControllerStatus>(addr, headers);
};

// Check for controller function and return controller status.
// https://docs.zerotier.com/service/v1/#operation/getControllerStatus

//Get Version
export const get_controller_version = async function () {
	const addr = `${LOCAL_ZT_ADDR}/controller`;

	// get headers based on local or central api
	const { headers } = await getOptions(false);
	try {
		return await getData<ZTControllerStatus>(addr, headers);
	} catch (error) {
		const message = "An error occurred while getting get_controller_version";
		throw new APIError(message, error as AxiosError);
	}
};

// List IDs of all networks hosted by this controller.
// https://docs.zerotier.com/service/v1/#operation/getControllerNetworks

type ZTControllerListNetworks = Array<string>;

// Get all networks
export const get_controller_networks = async function (
	isCentral = false,
): Promise<NetworkBase[] | string[]> {
	// get headers based on local or central api
	const { headers, ztCentralApiUrl } = await getOptions(isCentral);

	const addr = isCentral
		? `${ztCentralApiUrl}/network`
		: `${LOCAL_ZT_ADDR}/controller/network`;

	try {
		if (isCentral) {
			const data = await getData<CentralNetwork[]>(addr, headers);
			return flattenNetworks(data);
		} else {
			return await getData<ZTControllerListNetworks>(addr, headers);
		}
	} catch (error) {
		const prefix = isCentral ? "[CENTRAL] " : "";
		const message = `${prefix}An error occurred while getting get_controller_networks`;
		throw new APIError(message, axios.isAxiosError(error) ? error : undefined);
	}
};

/* 
  Node status and addressing info
  https://docs.zerotier.com/service/v1/#operation/getStatus
*/

export const get_controller_status = async function (
	isCentral: boolean,
): Promise<ZTControllerNodeStatus | CentralControllerStatus> {
	const { headers, ztCentralApiUrl } = await getOptions(isCentral);

	const addr = isCentral
		? `${ztCentralApiUrl}/status`
		: `${LOCAL_ZT_ADDR}/status`;

	try {
		if (isCentral) {
			return await getData<CentralControllerStatus>(addr, headers);
		} else {
			return await getData<ZTControllerNodeStatus>(addr, headers);
		}
	} catch (error) {
		const prefix = isCentral ? "[CENTRAL] " : "";
		const message = `${prefix}An error occurred while getting get_controller_status`;
		throw new APIError(message, error as AxiosError);
	}
};

/* 
  Create new zerotier network
  https://docs.zerotier.com/service/v1/#operation/createNetwork
*/
export const network_create = async (
	name: string,
	ipAssignment,
	isCentral = false,
): Promise<ZTControllerCreateNetwork | FlattenCentralNetwork> => {
	// get headers based on local or central api
	const { headers, ztCentralApiUrl } = await getOptions(isCentral);

	// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
	const payload: Partial<CentralNetwork> = {
		name,
		private: true,
		...ipAssignment,
	};

	try {
		if (isCentral) {
			const data = await postData<CentralNetwork>(
				`${ztCentralApiUrl}/network`,
				headers,
				{ config: { ...payload }, description: "created with ztnet" },
			);

			return flattenNetwork(data);
		} else {
			const controllerStatus = (await get_controller_status(
				isCentral,
			)) as ZTControllerNodeStatus;
			return await postData<ZTControllerCreateNetwork>(
				`${LOCAL_ZT_ADDR}/controller/network/${controllerStatus.address}______`,
				headers,
				payload,
			);
		}
	} catch (error) {
		const prefix = isCentral ? "[CENTRAL] " : "";
		const message = `${prefix}An error occurred while getting network_create`;
		throw new APIError(message, error as AxiosError);
	}
};

// delete network
// https://docs.zerotier.com/service/v1/#operation/deleteNetwork

export async function network_delete(
	nwid: string,
	isCentral = false,
): Promise<HttpResponse> {
	// get headers based on local or central api
	const { headers, ztCentralApiUrl } = await getOptions(isCentral);
	const addr = isCentral
		? `${ztCentralApiUrl}/network/${nwid}`
		: `${LOCAL_ZT_ADDR}/controller/network/${nwid}`;

	try {
		const response = await axios.delete(addr, { headers });

		return { status: response.status, data: undefined };
	} catch (error) {
		const prefix = isCentral ? "[CENTRAL] " : "";
		const message = `${prefix}An error occurred while getting network_delete`;
		throw new APIError(message, error as AxiosError);
	}
}

// Get Network Member Details by ID
// https://docs.zerotier.com/service/v1/#operation/getControllerNetworkMember

export const network_members = async function (
	nwid: string,
	isCentral = false,
) {
	// get headers based on local or central api
	const { headers, ztCentralApiUrl } = await getOptions(isCentral);
	try {
		const addr = isCentral
			? `${ztCentralApiUrl}/network/${nwid}/member`
			: `${LOCAL_ZT_ADDR}/controller/network/${nwid}/member`;

		// fetch members
		return await getData<MemberEntity[]>(addr, headers);
	} catch (error: unknown) {
		const prefix = isCentral ? "[CENTRAL] " : "";
		const message = `${prefix}An error occurred while getting network_members`;
		throw new APIError(message, error as AxiosError);
	}
};

export const local_network_detail = async function (
	nwid: string,
	isCentral = false,
): Promise<NetworkAndMemberResponse> {
	// get headers based on local or central api
	const { headers } = await getOptions(isCentral);
	try {
		// get all members for a specific network
		const members = await network_members(nwid);

		const network = await getData<NetworkEntity>(
			`${LOCAL_ZT_ADDR}/controller/network/${nwid}`,
			headers,
		);
		const membersArr: MemberEntity[] = [];
		for (const [memberId] of Object.entries(members)) {
			const memberDetails = await getData<MemberEntity>(
				`${LOCAL_ZT_ADDR}/controller/network/${nwid}/member/${memberId}`,
				headers,
			);

			membersArr.push(memberDetails);
		}

		return {
			network: { ...network },
			members: [...membersArr],
		};
	} catch (error) {
		const message =
			"An error occurred while getting data from network_details function";
		throw new APIError(message, error as AxiosError);
	}
};
// Get network details
// https://docs.zerotier.com/service/v1/#operation/getNetwork

export const central_network_detail = async function (
	nwid: string,
	isCentral = false,
): Promise<NetworkAndMemberResponse> {
	// get headers based on local or central api
	const { headers, ztCentralApiUrl } = await getOptions(isCentral);
	try {
		const addr = isCentral
			? `${ztCentralApiUrl}/network/${nwid}`
			: `${LOCAL_ZT_ADDR}/controller/network/${nwid}`;

		// get all members for a specific network
		const members = await network_members(nwid, isCentral);
		const network = await getData<CentralNetwork>(addr, headers);

		const membersArr = await Promise.all(
			members?.map(async (member) => {
				return await getData<MemberEntity>(
					`${addr}/member/${member?.nodeId}`,
					headers,
				);
			}),
		);

		// Get available cidr options.
		const ipAssignmentPools = IPv4gen(null);
		const { cidrOptions } = ipAssignmentPools;

		const { id: networkId, config: networkConfig, ...restData } = network;

		return {
			network: {
				cidr: cidrOptions,
				nwid: networkId,
				...restData,
				...networkConfig,
			},
			members: [...flattenCentralMembers(membersArr)],
		};
	} catch (error) {
		const source = isCentral ? "[ZT CENTRAL]" : "";
		const message = `${source} An error occurred while getting data from network_details function`;
		throw new APIError(message, error as AxiosError);
	}
};

type networkUpdate = {
	nwid: string;
	updateParams: Partial<NetworkEntity>;
	central?: boolean;
};

// Get network details
// https://docs.zerotier.com/service/v1/#operation/getNetwork
export const network_update = async function ({
	nwid,
	updateParams: payload,
	central = false,
}: networkUpdate): Promise<Partial<NetworkEntity>> {
	// get headers based on local or central api
	const { headers, ztCentralApiUrl } = await getOptions(central);
	const addr = central
		? `${ztCentralApiUrl}/network/${nwid}`
		: `${LOCAL_ZT_ADDR}/controller/network/${nwid}`;

	try {
		return await postData<NetworkEntity>(addr, headers, payload);
	} catch (error) {
		const prefix = central ? "[CENTRAL] " : "";
		const message = `${prefix}An error occurred while getting network_update`;
		throw new APIError(message, error as AxiosError);
	}
};

// Delete Network Member by ID
// https://docs.zerotier.com/service/v1/#operation/deleteControllerNetworkMember

export const member_delete = async ({
	nwid,
	memberId,
	central = false,
}: MemberDeleteInput): Promise<Partial<MemberDeleteResponse>> => {
	// get headers based on local or central api
	const { headers, ztCentralApiUrl } = await getOptions(central);
	const addr = central
		? `${ztCentralApiUrl}/network/${nwid}/member/${memberId}`
		: `${LOCAL_ZT_ADDR}/controller/network/${nwid}/member/${memberId}`;

	try {
		const response: AxiosResponse = await axios.delete(addr, { headers });
		return response.status as MemberDeleteResponse;
	} catch (error) {
		const prefix = central ? "[CENTRAL] " : "";
		const message = `${prefix}An error occurred while getting member_delete`;
		throw new APIError(message, error as AxiosError);
	}
};

type memberUpdate = {
	nwid: string;
	memberId: string;
	updateParams: Partial<MemberEntity> | Partial<CentralMemberConfig>;
	central?: boolean;
};

// Update Network Member by ID
// https://docs.zerotier.com/service/v1/#operation/updateControllerNetworkMember
export const member_update = async ({
	nwid,
	memberId,
	updateParams: payload,
	central = false,
}: memberUpdate) => {
	// get headers based on local or central api
	const { headers, ztCentralApiUrl } = await getOptions(central);
	const addr = central
		? `${ztCentralApiUrl}/network/${nwid}/member/${memberId}`
		: `${LOCAL_ZT_ADDR}/controller/network/${nwid}/member/${memberId}`;

	try {
		return await postData<MemberEntity>(addr, headers, payload);
	} catch (error) {
		const prefix = central ? "[CENTRAL] " : "";
		const message = `${prefix}An error occurred while getting member_update`;
		throw new APIError(message, error as AxiosError);
	}
};

// Get Network Member Details by ID
// https://docs.zerotier.com/service/v1/#operation/getControllerNetworkMember

export const member_details = async function (
	nwid: string,
	memberId: string,
	central = false,
): Promise<MemberEntity> {
	// get headers based on local or central api
	const { headers, ztCentralApiUrl } = await getOptions(central);

	try {
		const addr = central
			? `${ztCentralApiUrl}/network/${nwid}/member/${memberId}`
			: `${LOCAL_ZT_ADDR}/controller/network/${nwid}/member/${memberId}`;

		return await getData<MemberEntity>(addr, headers);
	} catch (error) {
		const message = "An error occurred while getting member_detail";
		throw new APIError(message, error as AxiosError);
	}
};

// Get all peers
// https://docs.zerotier.com/service/v1/#operation/getPeers
export const peers = async (): Promise<ZTControllerGetPeer> => {
	const addr = `${LOCAL_ZT_ADDR}/peer`;

	// get headers based on local or central api
	const { headers } = await getOptions(false);

	try {
		const response: AxiosResponse = await axios.get(addr, { headers });
		return response.data as ZTControllerGetPeer;
	} catch (error) {
		const message = "An error occurred while getting peers";
		throw new APIError(message, error as AxiosError);
	}
};

// Get information about a specific peer by Node ID.
// https://docs.zerotier.com/service/v1/#operation/getPeer
export const peer = async (userZtAddress: string) => {
	const addr = `${LOCAL_ZT_ADDR}/peer/${userZtAddress}`;
	try {
		// get headers based on local or central api
		const { headers } = await getOptions(false);
		const response = await getData<ZTControllerGetPeer>(addr, headers);

		if (!response) return {} as ZTControllerGetPeer;
		return response as ZTControllerGetPeer;
	} catch (error) {
		console.error(error);
		return [];
	}
};
