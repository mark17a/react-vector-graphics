import * as path from 'path'

import minimatch from 'minimatch'
import { Octokit } from '@octokit/rest'
import { ReposCompareCommitsResponseData } from '@octokit/types'

import { NamingScheme, PluginParams, State } from '@react-vector-graphics/types'
import { pathToName } from '@react-vector-graphics/utils'

import { EMPTY_SVG, STATE, STATUSES } from './constants'
import { fromBase64, normaliseGlob, toBase64 } from './utils'

type Unpacked<T> = T extends (infer U)[] ? U : T

const findAssets = async ({
    folderPath = '',
    github: { api: githubApi, base = 'master', ...githubParams },
    ...params
}: {
    folderPath: string
    github: {
        api: Octokit
        base: string
        head: string
        owner: string
        repo: string
    }
    globPattern: string
    nameScheme: NamingScheme
    state: State
}): Promise<PluginParams[]> => {
    const compareCommitsResult = await githubApi.repos.compareCommits({
        ...githubParams,
        base,
    })
    const svgFiles: (Unpacked<ReposCompareCommitsResponseData['files']> & {
        // eslint-disable-next-line camelcase
        previous_filename?: string
    })[] = compareCommitsResult.data.files.filter(file => {
        const isInFolder = file.filename.startsWith(folderPath)
        if (!isInFolder) return false
        const relPath = path.relative(folderPath, file.filename)
        return minimatch(relPath, normaliseGlob(params.globPattern))
    })
    const pluginParams = svgFiles.map(
        async (file): Promise<PluginParams> => {
            const filePath = path.relative(folderPath, file.filename)
            const { data } =
                file.status === STATUSES.REMOVED
                    ? { data: { content: toBase64(EMPTY_SVG) } }
                    : await githubApi.repos.getContent({
                          ...githubParams,
                          base,
                          path: file.filename,
                          ref: githubParams.head,
                      })
            if (Array.isArray(data) || !data.content) {
                throw new Error(`Could not get contents for ${file.filename}`)
            }
            return {
                code: fromBase64(data.content.toString()),
                state: Object.assign(
                    {
                        [STATE.COMPONENT_NAME]: pathToName(
                            filePath,
                            params.nameScheme,
                        ),
                        [STATE.COMPONENT_NAME_OLD]:
                            file.previous_filename &&
                            pathToName(
                                path.relative(
                                    folderPath,
                                    file.previous_filename,
                                ),
                                params.nameScheme,
                            ),
                        [STATE.DIFF_TYPE]: file.status,
                        [STATE.FILE_PATH]: filePath,
                    },
                    params.state,
                ),
            }
        },
    )
    return Promise.all(pluginParams)
}

export default findAssets
